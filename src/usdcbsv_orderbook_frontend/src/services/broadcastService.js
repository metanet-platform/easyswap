import { ec as EC } from 'elliptic';
import SHA256 from 'crypto-js/sha256';

const BROADCAST_API_URL = 'https://api.metanet.ninja/data/api';

/**
 * Broadcast BSV transactions to the network via Metanet overlay service
 * @param {string[]} rawTxHexArray - Array of raw transaction hex strings
 * @param {string} privateKeyHex - Private key hex for signing the request
 * @param {string} source - App identifier (e.g., 'usdcbsv-orderbook')
 * @returns {Promise<Object>} Broadcast result
 */
export async function broadcastTransactions(rawTxHexArray, privateKeyHex, source = 'usdcbsv-orderbook') {
  try {
    console.log('=== BROADCASTING TRANSACTIONS ===');
    console.log('Number of transactions:', rawTxHexArray.length);
    console.log('Source:', source);

    // Step 1: Create the payload
    const payload = {
      data: {
        action: "broadcastTransactions",
        raws: rawTxHexArray, // Array of transaction hex strings (single or multiple)
        params: { source: source, timestamp: Date.now() }
      }
    };

    // Step 2: Sign the payload for authentication (EXACT metanet_front implementation)
    const ecInstance = new EC('secp256k1');
    const keyPair = ecInstance.keyFromPrivate(privateKeyHex);
    const publicKeyHex = keyPair.getPublic(true, 'hex');

    // Build canonical payload with data wrapper (matches metanet_front signPayload)
    const canonicalPayloadStr = JSON.stringify({ data: payload.data });

    // Compute SHA256 hash and convert to Buffer (CRITICAL: no 'hex' parameter!)
    const hashHex = Buffer.from(SHA256(canonicalPayloadStr).toString());
    const signature = keyPair.sign(hashHex, { canonical: true }).toDER('hex');

    console.log('Public key (compressed):', publicKeyHex);
    console.log('Signature:', signature.substring(0, 32) + '...');

    // Step 3: Make the API call (body is the canonicalPayloadStr)
    const response = await fetch(BROADCAST_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': signature,      // DER-encoded signature
        'x-pubkey': publicKeyHex       // Compressed public key (33 bytes, hex)
      },
      body: canonicalPayloadStr        // Send the canonical string (with data wrapper)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('Broadcast result:', result);

    // Validate response
    if (!result.success) {
      throw new Error(result.error || 'Broadcast failed');
    }

    // Check individual transaction results
    const failures = result.data.filter(tx => !tx.success);
    if (failures.length > 0) {
      console.error('Some transactions failed:', failures);
      throw new Error(`${failures.length} transaction(s) failed to broadcast`);
    }

    console.log('✅ All transactions broadcast successfully');
    console.log('TXIDs:', result.data.map(tx => tx.txid));
    console.log('=================================');

    return result;
  } catch (error) {
    console.error('❌ Broadcast error:', error);
    throw error;
  }
}

/**
 * Broadcast a single BSV transaction
 * @param {string} rawTxHex - Raw transaction hex string
 * @param {string} privateKeyHex - Private key hex for signing the request
 * @param {string} source - App identifier
 * @returns {Promise<Object>} Broadcast result with txid
 */
export async function broadcastTransaction(rawTxHex, privateKeyHex, source = 'usdcbsv-orderbook') {
  const result = await broadcastTransactions([rawTxHex], privateKeyHex, source);
  return result.data[0]; // Return first (and only) transaction result
}

/**
 * Get the secp256k1 private key from genericUseSeed for broadcast authentication
 * The genericUseSeed from Metanet is already a secp256k1 private key (32 bytes hex)
 * that works for both Ethereum and Bitcoin SV (both use the same elliptic curve)
 * @param {string} genericUseSeed - 64-character hex string private key from Metanet SDK
 * @returns {string} Private key hex (without 0x prefix)
 */
export function getPrivateKeyFromIdentity(genericUseSeed) {
  if (!genericUseSeed) {
    throw new Error('genericUseSeed is required for broadcast authentication');
  }
  
  if (typeof genericUseSeed !== 'string') {
    throw new Error('genericUseSeed must be a string');
  }
  
  // Remove 0x prefix if present
  const cleanKey = genericUseSeed;
  
  // Validate it's a 64-character hex string (32 bytes)
  if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    throw new Error('genericUseSeed must be a 64-character hex string (32 bytes)');
  }
  
  return cleanKey;
}
