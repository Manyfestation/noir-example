# Noir example

`Prover.toml` holds the circuit inputs

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run dev
```

The server will start on `http://localhost:5173` (default Vite port).

## Usage

Execute the Noir circuit:
```bash
nargo execute
```

Generate proof:
```bash
bb prove -b ./target/simple_proof.json -w ./target/simple_proof.gz --write_vk -o target
```
