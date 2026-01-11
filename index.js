
console.log("Index.js loaded. Starting execution...");

// Polyfill check
if (typeof Buffer === 'undefined') {
    console.warn("Buffer not defined initially. dependent libs might fail.");
} else {
    console.log("Buffer is defined.");
}

// We will use dynamic imports to ensure we can catch loading errors
// and to ensure polyfills are active.

import initNoirC from '@noir-lang/noirc_abi';
import initACVM from '@noir-lang/acvm_js';
import acvm from '@noir-lang/acvm_js/web/acvm_js_bg.wasm?url';
import noirc from '@noir-lang/noirc_abi/web/noirc_abi_wasm_bg.wasm?url';
import circuit from './target/simple_proof.json';

// UI Elements
const logDiv = document.getElementById('logs');
const statusSpan = document.getElementById('main-status');
const witnessTimeSpan = document.getElementById('witness-time');
const proofTimeSpan = document.getElementById('proof-time');
const verifyTimeSpan = document.getElementById('verify-time');
const proofSizeSpan = document.getElementById('proof-size');
const msgInput = document.getElementById('message-input');
const sigDisplay = document.getElementById('signature-display');
const btnGen = document.getElementById('gen-sig-btn');
const btnProve = document.getElementById('prove-btn');
const btnVerify = document.getElementById('verify-btn');

let noir, backend, bb;
let currentWitness = null;
let currentProof = null;
let currentInputs = null;
let Barretenberg, UltraHonkBackend, Noir;

// Logger
const log = (msg, type = 'info') => {
    const div = document.createElement('div');
    div.className = `log-entry ${type}`;
    div.textContent = `> ${msg}`;
    if (logDiv) {
        logDiv.appendChild(div);
        div.scrollIntoView({ behavior: 'smooth' });
    }
    console.log(`[APP] ${msg}`);
};

// Utils
const hexToBytes = (hex) => {
    let bytes = [];
    for (let c = 0; c < hex.length; c += 2)
        bytes.push(parseInt(hex.substr(c, 2), 16));
    return bytes;
};

async function init() {
    try {
        statusSpan.textContent = "Loading Libs...";
        log("Importing libraries dynamically...");

        // Dynamic imports
        try {
            const bbModule = await import('@aztec/bb.js');
            Barretenberg = bbModule.Barretenberg;
            UltraHonkBackend = bbModule.UltraHonkBackend;
            log("Barretenberg loaded.");
        } catch (e) {
            throw new Error(`Failed to load @aztec/bb.js: ${e.message}`);
        }

        try {
            const noirModule = await import('@noir-lang/noir_js');
            Noir = noirModule.Noir;
            log("NoirJS loaded.");
        } catch (e) {
            throw new Error(`Failed to load @noir-lang/noir_js: ${e.message}`);
        }

        statusSpan.textContent = "Initializing WASM...";
        log("Loading WASM modules...");
        await Promise.all([initACVM(fetch(acvm)), initNoirC(fetch(noirc))]);

        log("Initializing Noir & Barretenberg...");
        noir = new Noir(circuit);

        // This is the heavy part - downloading the 100MB+ SRS or initializing WASM threads
        log("Looking for threads...");
        // Use 1 thread to avoid COOP/COEP issues if they persist
        bb = await Barretenberg.new({ threads: 1 });

        log("Barretenberg initialized.");
        // New API: UltraHonkBackend(acirBytecode, backendOptions?, circuitOptions?)
        backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });

        statusSpan.textContent = "Ready";
        log("Initialization complete!", "success");
        statusSpan.style.color = "var(--success-color)";
    } catch (e) {
        log(`Initialization failed: ${e.message}`, "error");
        console.error("Init Error Details:", e);
        statusSpan.textContent = "Error";
        statusSpan.style.color = "var(--error-color)";
    }
}

// Generate Signature
if (btnGen) {
    btnGen.addEventListener('click', async () => {
        try {
            const msgStr = msgInput.value;
            let msgBytes = new TextEncoder().encode(msgStr);
            if (msgBytes.length > 10) {
                msgBytes = msgBytes.slice(0, 10);
                log("Message truncated to 10 bytes", "info");
            } else if (msgBytes.length < 10) {
                const padded = new Uint8Array(10);
                padded.set(msgBytes);
                msgBytes = padded;
            }

            log("Generating random Schnorr identity...");

            // Use the new Barretenberg API for random field element generation
            const { value: privateKey } = await bb.grumpkinGetRandomFr({ dummy: 0 });

            // Compute public key from private key
            const { publicKey: pubKey } = await bb.schnorrComputePublicKey({ privateKey });

            // Sign the message
            const { s, e } = await bb.schnorrConstructSignature({
                message: msgBytes,
                privateKey
            });

            // Combine s and e into a 64-byte signature array
            const signatureBytes = new Uint8Array(64);
            signatureBytes.set(s, 0);
            signatureBytes.set(e, 32);

            log("Identity generated and message signed.", "success");
            sigDisplay.value = Buffer.from(signatureBytes).toString('hex');

            // Helper function to convert Fr (Uint8Array) to hex string for Noir
            const frToHexString = (fr) => {
                return '0x' + Buffer.from(fr).toString('hex');
            };

            currentInputs = {
                pub_key_x: frToHexString(pubKey.x),
                pub_key_y: frToHexString(pubKey.y),
                signature: Array.from(signatureBytes),
                message: Array.from(msgBytes)
            };

            log(`Inputs ready for proving.`, 'info');
            btnProve.disabled = false;
            btnVerify.disabled = true;
            currentProof = null;
            witnessTimeSpan.textContent = "0 ms";
            proofTimeSpan.textContent = "0 ms";
            verifyTimeSpan.textContent = "0 ms";
            proofSizeSpan.textContent = "0 bytes";

        } catch (e) {
            log(`Error generating signature: ${e.message}`, "error");
            console.error(e);
        }
    });
}

// Prove
if (btnProve) {
    btnProve.addEventListener('click', async () => {
        if (!currentInputs) return;
        try {
            btnProve.disabled = true;
            statusSpan.textContent = "Proving...";

            // 1. Generate Witness
            log("Executing circuit (Witness Generation)...");
            const t0 = performance.now();
            const { witness } = await noir.execute(currentInputs);
            const t1 = performance.now();
            const witnessTime = (t1 - t0).toFixed(2);
            witnessTimeSpan.textContent = `${witnessTime} ms`;
            log(`Witness generated in ${witnessTime} ms`, "success");
            currentWitness = witness;

            // 2. Generate Proof
            log("Generating Proof with Barretenberg...");
            const t2 = performance.now();
            const proof = await backend.generateProof(witness);
            const t3 = performance.now();
            const proofTime = (t3 - t2).toFixed(2);
            proofTimeSpan.textContent = `${proofTime} ms`;
            log(`Proof generated in ${proofTime} ms`, "success");

            // Display proof size
            const proofBytes = proof.proof.length;
            proofSizeSpan.textContent = `${proofBytes} bytes`;

            currentProof = proof;
            btnVerify.disabled = false;
            statusSpan.textContent = "Proof Ready";
        } catch (e) {
            log(`Proving failed: ${e.message}`, "error");
            console.error(e);
            statusSpan.textContent = "Error";
            btnProve.disabled = false;
        }
    });
}

// Verify
if (btnVerify) {
    btnVerify.addEventListener('click', async () => {
        if (!currentProof) return;
        try {
            btnVerify.disabled = true;
            statusSpan.textContent = "Verifying...";

            log("Verifying Proof...");
            const t0 = performance.now();
            const isValid = await backend.verifyProof(currentProof);
            const t1 = performance.now();
            const verifyTime = (t1 - t0).toFixed(2);
            verifyTimeSpan.textContent = `${verifyTime} ms`;

            if (isValid) {
                log(`Proof VERIFIED! ✅`, "success");
                statusSpan.textContent = "Verified";
            } else {
                log(`Proof REJECTED! ❌`, "error");
                statusSpan.textContent = "Invalid";
            }
            btnVerify.disabled = false;
        } catch (e) {
            log(`Verification failed: ${e.message}`, "error");
            statusSpan.textContent = "Error";
            btnVerify.disabled = false;
        }
    });
}

// Start
init();
