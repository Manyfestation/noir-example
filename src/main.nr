use schnorr::assert_valid_signature;
use std::embedded_curve_ops::EmbeddedCurvePoint;
use std::hash::pedersen_hash;

fn main(
    pub_key_x: Field,
    pub_key_y: Field,
    signature: [u8; 64],
    message: [u8; 10]
) -> pub Field {
    let pub_key = EmbeddedCurvePoint {
        x: pub_key_x,
        y: pub_key_y,
        is_infinite: false
    };

    assert_valid_signature(pub_key, signature, message);

    // Hash all private inputs to create a public commitment
    let mut sig_field_lo: Field = 0;
    let mut sig_field_hi: Field = 0;
    for i in 0..32 {
        sig_field_lo = sig_field_lo * 256 + signature[i] as Field;
        sig_field_hi = sig_field_hi * 256 + signature[32 + i] as Field;
    }

    // Convert message bytes to field
    let mut msg_field: Field = 0;
    for i in 0..10 {
        msg_field = msg_field * 256 + message[i] as Field;
    }

    let commitment = pedersen_hash([pub_key_x, pub_key_y, sig_field_lo, sig_field_hi, msg_field]);
    
    commitment
}

#[test]
fn test_valid_signature() {
    let message: [u8; 10] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let pub_key_x: Field = 0x04b260954662e97f00cab9adb773a259097f7a274b83b113532bce27fa3fb96a;
    let pub_key_y: Field = 0x2fd51571db6c08666b0edfbfbc57d432068bccd0110a39b166ab243da0037197;
    
    let signature: [u8; 64] = [
        1, 13, 119, 112, 212, 39, 233, 41, 84, 235, 255, 93, 245, 172, 186, 83, 157, 253, 76,
        77, 33, 128, 178, 15, 214, 67, 105, 107, 177, 234, 77, 48, 27, 237, 155, 84, 39, 84,
        247, 27, 22, 8, 176, 230, 24, 115, 145, 220, 254, 122, 135, 179, 171, 4, 214, 202, 64,
        199, 19, 84, 239, 138, 124, 12
    ];

    // Test main returns a commitment hash
    let commitment = main(pub_key_x, pub_key_y, signature, message);
    // The commitment should be non-zero
    assert(commitment != 0);
    
    // Log the commitment value for reference
    std::println(f"Commitment hash: {commitment}");
}
