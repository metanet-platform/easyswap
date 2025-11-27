use crate::types::*;

pub fn parse_bsv_transaction(raw_hex: &str) -> Result<ParsedBsvTx, String> {
    let bytes = hex::decode(raw_hex)
        .map_err(|e| format!("Failed to decode hex: {}", e))?;
    
    if bytes.len() < 10 {
        return Err("Transaction too short".to_string());
    }
    
    let mut cursor = 0;
    
    // Parse version (4 bytes, little-endian)
    let version = read_u32_le(&bytes, &mut cursor)?;
    
    // Parse inputs
    let input_count = read_varint(&bytes, &mut cursor)?;
    let mut inputs = Vec::new();
    
    for _ in 0..input_count {
        let input = parse_input(&bytes, &mut cursor)?;
        inputs.push(input);
    }
    
    // Parse outputs
    let output_count = read_varint(&bytes, &mut cursor)?;
    let mut outputs = Vec::new();
    
    for _ in 0..output_count {
        let output = parse_output(&bytes, &mut cursor)?;
        outputs.push(output);
    }
    
    // Parse locktime (4 bytes, little-endian)
    let locktime = read_u32_le(&bytes, &mut cursor)?;
    
    // Debug logging
    ic_cdk::println!("📝 BSV TX PARSED:");
    ic_cdk::println!("  Version: {}", version);
    ic_cdk::println!("  Inputs: {}", inputs.len());
    ic_cdk::println!("  Outputs: {}", outputs.len());
    for (i, output) in outputs.iter().enumerate() {
        ic_cdk::println!("    Output #{}: {} sats -> {}", i, output.satoshis, output.address);
    }
    ic_cdk::println!("  Locktime: {}", locktime);
    
    Ok(ParsedBsvTx {
        version,
        inputs,
        outputs,
        locktime,
    })
}

fn parse_input(bytes: &[u8], cursor: &mut usize) -> Result<BsvInput, String> {
    // Previous transaction hash (32 bytes, reversed for display)
    let mut prev_tx_hash = read_bytes(bytes, cursor, 32)?;
    prev_tx_hash.reverse(); // Reverse for human-readable format
    
    // Previous output index (4 bytes, little-endian)
    let prev_output_index = read_u32_le(bytes, cursor)?;
    
    // Script signature length
    let script_len = read_varint(bytes, cursor)?;
    let script_sig = read_bytes(bytes, cursor, script_len as usize)?;
    
    // Sequence (4 bytes, little-endian)
    let sequence = read_u32_le(bytes, cursor)?;
    
    Ok(BsvInput {
        prev_tx_hash,
        prev_output_index,
        script_sig,
        sequence,
    })
}

fn parse_output(bytes: &[u8], cursor: &mut usize) -> Result<BsvOutput, String> {
    // Value in satoshis (8 bytes, little-endian)
    let satoshis = read_u64_le(bytes, cursor)?;
    
    // Script pub key length
    let script_len = read_varint(bytes, cursor)?;
    let script_pubkey = read_bytes(bytes, cursor, script_len as usize)?;
    
    // Extract address from script
    let address = extract_address_from_script(&script_pubkey)?;
    
    Ok(BsvOutput {
        address,
        satoshis,
    })
}

fn extract_address_from_script(script: &[u8]) -> Result<String, String> {
    if script.is_empty() {
        return Err("Empty script".to_string());
    }
    
    // P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
    if script.len() == 25 && script[0] == 0x76 && script[1] == 0xa9 && script[2] == 0x14 {
        let pubkey_hash = &script[3..23];
        return encode_base58_check(pubkey_hash, 0x00); // Mainnet P2PKH prefix
    }
    
    // P2SH: OP_HASH160 <20 bytes> OP_EQUAL
    if script.len() == 23 && script[0] == 0xa9 && script[1] == 0x14 {
        let script_hash = &script[2..22];
        return encode_base58_check(script_hash, 0x05); // Mainnet P2SH prefix
    }
    
    // Unknown script type - return hex representation (valid for non-standard scripts)
    Ok(format!("0x{}", hex::encode(script)))
}

fn encode_base58_check(payload: &[u8], version: u8) -> Result<String, String> {
    use sha2::{Sha256, Digest};
    
    let mut data = vec![version];
    data.extend_from_slice(payload);
    
    // Double SHA256 for checksum
    let hash1 = Sha256::digest(&data);
    let hash2 = Sha256::digest(&hash1);
    let checksum = &hash2[0..4];
    
    data.extend_from_slice(checksum);
    
    Ok(bs58::encode(data).into_string())
}

// Helper functions for reading bytes

fn read_bytes(bytes: &[u8], cursor: &mut usize, len: usize) -> Result<Vec<u8>, String> {
    if *cursor + len > bytes.len() {
        return Err("Unexpected end of data".to_string());
    }
    let result = bytes[*cursor..*cursor + len].to_vec();
    *cursor += len;
    Ok(result)
}

fn read_u32_le(bytes: &[u8], cursor: &mut usize) -> Result<u32, String> {
    if *cursor + 4 > bytes.len() {
        return Err("Unexpected end of data reading u32".to_string());
    }
    let value = u32::from_le_bytes([
        bytes[*cursor],
        bytes[*cursor + 1],
        bytes[*cursor + 2],
        bytes[*cursor + 3],
    ]);
    *cursor += 4;
    Ok(value)
}

fn read_u64_le(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    if *cursor + 8 > bytes.len() {
        return Err("Unexpected end of data reading u64".to_string());
    }
    let value = u64::from_le_bytes([
        bytes[*cursor],
        bytes[*cursor + 1],
        bytes[*cursor + 2],
        bytes[*cursor + 3],
        bytes[*cursor + 4],
        bytes[*cursor + 5],
        bytes[*cursor + 6],
        bytes[*cursor + 7],
    ]);
    *cursor += 8;
    Ok(value)
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, String> {
    if *cursor >= bytes.len() {
        return Err("Unexpected end of data reading varint".to_string());
    }
    
    let first_byte = bytes[*cursor];
    *cursor += 1;
    
    match first_byte {
        0..=0xfc => Ok(first_byte as u64),
        0xfd => {
            let value = u16::from_le_bytes([bytes[*cursor], bytes[*cursor + 1]]);
            *cursor += 2;
            Ok(value as u64)
        }
        0xfe => {
            let value = read_u32_le(bytes, cursor)?;
            Ok(value as u64)
        }
        0xff => {
            read_u64_le(bytes, cursor)
        }
    }
}

pub fn validate_transaction_outputs(
    parsed_tx: &ParsedBsvTx,
    expected_outputs: &[LockedChunk],
) -> Result<(), String> {
    ic_cdk::println!("🔍 BSV TX VALIDATION DEBUG:");
    ic_cdk::println!("  Transaction has {} outputs", parsed_tx.outputs.len());
    ic_cdk::println!("  Expected {} outputs (locked chunks)", expected_outputs.len());
    
    // Must have at least as many outputs as expected
    if parsed_tx.outputs.len() < expected_outputs.len() {
        return Err(format!(
            "Transaction has {} outputs but {} were expected",
            parsed_tx.outputs.len(),
            expected_outputs.len()
        ));
    }
    
    // Validate each expected output in order
    for (i, expected) in expected_outputs.iter().enumerate() {
        let actual = &parsed_tx.outputs[i];
        
        ic_cdk::println!("\n  ✅ Validating output #{}", i);
        ic_cdk::println!("    Chunk ID: {}", expected.chunk_id);
        ic_cdk::println!("    Expected Address: {}", expected.bsv_address);
        ic_cdk::println!("    Actual Address:   {}", actual.address);
        ic_cdk::println!("    Expected Satoshis: {} sats", expected.sats_amount);
        ic_cdk::println!("    Actual Satoshis:   {} sats", actual.satoshis);
        
        // Check satoshi amount matches (LockedChunk has required sats_amount)
        let expected_sats = expected.sats_amount;
        if actual.satoshis != expected_sats {
            ic_cdk::println!("    ❌ AMOUNT MISMATCH!");
            return Err(format!(
                "Output {} amount mismatch. Expected: {} sats, Got: {} sats",
                i, expected_sats, actual.satoshis
            ));
        }
        
        // Check address matches (normalize both addresses for comparison)
        let actual_addr = actual.address.trim().to_lowercase();
        let expected_addr = expected.bsv_address.trim().to_lowercase();
        
        ic_cdk::println!("    Normalized Expected: {}", expected_addr);
        ic_cdk::println!("    Normalized Actual:   {}", actual_addr);
        
        if actual_addr != expected_addr && !actual_addr.contains(&expected_addr) {
            ic_cdk::println!("    ❌ ADDRESS MISMATCH!");
            return Err(format!(
                "Output {} address mismatch. Expected: {}, Got: {}",
                i, expected.bsv_address, actual.address
            ));
        }
        
        ic_cdk::println!("    ✅ Output #{} validated successfully", i);
    }
    
    ic_cdk::println!("\n✅ All {} outputs validated successfully!", expected_outputs.len());
    
    Ok(())
}
