import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { ec as EC } from 'elliptic';
import SHA256 from 'crypto-js/sha256';
import CryptoJS from 'crypto-js';
import { Actor, HttpAgent, AnonymousIdentity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { DelegationIdentity, DelegationChain, Ed25519KeyIdentity } from '@dfinity/identity';
import { Buffer } from 'buffer';
import { CK_USDC_LEDGER } from '../config';

// Polyfill Buffer for browser
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

const ec = new EC('secp256k1');
const SDKContext = createContext();
export const useSDK = () => useContext(SDKContext);

const verifySignature = (payload, signatureHex, pk) => {
  try {
    const canonicalPayloadStr = JSON.stringify(payload);
    const hashHex = SHA256(canonicalPayloadStr).toString();
    let key;
    try {
      key = ec.keyFromPublic(pk, 'hex');
    } catch (err) {
      return { valid: false };
    }
    const isValid = key.verify(hashHex, signatureHex);
    return { valid: isValid };
  } catch (err) {
    console.error("Verification exception:", err);
    return { valid: false };
  }
};

function buildIdentityFromPackage(identityPackage) {
  try {
    if (!identityPackage.appId || !identityPackage.timestamp || !identityPackage.expirationDate) {
      console.error('Invalid identity package: missing security metadata');
      return null;
    }
    
    const expirationDate = new Date(identityPackage.expirationDate);
    if (expirationDate < new Date()) {
      console.error('Identity package has expired');
      return null;
    }
    
    const packageTimestamp = identityPackage.timestamp;
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000;
    if (now - packageTimestamp > maxAge) {
      console.error('Identity package is too old');
      return null;
    }
    
    const delegatee = Ed25519KeyIdentity.fromSecretKey(
      new Uint8Array(Buffer.from(identityPackage.privateKey, 'hex'))
    );
    const delegationChain = DelegationChain.fromJSON(identityPackage.delegation);
    return DelegationIdentity.fromDelegation(delegatee, delegationChain);
  } catch (error) {
    console.error('Error building identity from package:', error);
    return null;
  }
}

export const SDKProvider = ({ children, canisterId, idlFactory }) => {
  const [icIdentity, setIcIdentity] = useState(null);
  const [icDelegation, setIcDelegation] = useState(null);
  const [initiatorAddress, setInitiatorAddress] = useState(null);
  const [initiatorPublicKey, setInitiatorPublicKey] = useState(null);
  const [rootPrincipal, setRootPrincipal] = useState(null);
  const [connectionData, setConnectionData] = useState(null);
  const [genericUseSeed, setGenericUseSeed] = useState(null);
  const [actor, setActor] = useState(null);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [delegationExpirationDate, setDelegationExpirationDate] = useState(null);

  const icIdentityRef = useRef(icIdentity);
  const initiatorPublicKeyRef = useRef(initiatorPublicKey);
  const delegationExpirationRef = useRef(delegationExpirationDate);
  
  useEffect(() => { icIdentityRef.current = icIdentity; }, [icIdentity]);
  useEffect(() => { initiatorPublicKeyRef.current = initiatorPublicKey; }, [initiatorPublicKey]);
  useEffect(() => { delegationExpirationRef.current = delegationExpirationDate; }, [delegationExpirationDate]);

  // Store last connection time in localStorage
  const updateLastConnectionTime = () => {
    localStorage.setItem('lastConnectionTime', Date.now().toString());
  };

  const getLastConnectionTime = () => {
    const stored = localStorage.getItem('lastConnectionTime');
    return stored ? parseInt(stored, 10) : 0;
  };

  // Initialize actor when IC identity is available
  useEffect(() => {
    if (icIdentity && canisterId && idlFactory) {
      (async () => {
        try {
          const httpAgent = await HttpAgent.create({ identity: icIdentity });

          const newActor = Actor.createActor(idlFactory, {
            agent: httpAgent,
            canisterId: canisterId,
          });
          setActor(newActor);
        } catch (error) {
          console.error('Error creating actor:', error);
        }
      })();
    }
  }, [icIdentity, canisterId, idlFactory]);

  // Hourly auto-reconnection check
  useEffect(() => {
    if (isAnonymous) return;

    const checkReconnection = () => {
      const now = Date.now();
      const lastConnection = getLastConnectionTime();
      const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

      // If more than 1 hour has passed since last connection, request fresh connection
      if (lastConnection && (now - lastConnection > oneHour)) {
        console.log('Hourly reconnection triggered');
        sendCommand({ type: "connection", navbg:"#9333ea" });
      }
    };

    // Check immediately
    checkReconnection();
    
    // Then check every 5 minutes
    const interval = setInterval(checkReconnection, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAnonymous]);

  // Auto-renewal effect (legacy 5-minute check)
  useEffect(() => {
    if (!delegationExpirationDate || isAnonymous) return;

    const checkExpiration = () => {
      const now = new Date();
      const timeUntilExpiration = delegationExpirationDate.getTime() - now.getTime();
      const fiveMinutes = 5 * 60 * 1000;

      if (timeUntilExpiration <= fiveMinutes) {
        console.log('Delegation expiring soon, requesting fresh connection');
        sendCommand({ type: "connection", navbg:"#9333ea" });
      }
    };

    checkExpiration();
    const interval = setInterval(checkExpiration, 60 * 1000);
    return () => clearInterval(interval);
  }, [delegationExpirationDate, isAnonymous]);

  const messageHandlers = useRef(new Map());

  const sendCommand = (commandObj) => {
    try {
      window.parent.postMessage({ command: "ninja-app-command", detail: commandObj }, "*");
    } catch (err) {
      console.error("SDKProvider sendCommand error:", err);
    }
  };

  const onCommand = (listener) => {
    const handler = (event) => {
      if (event.data && (event.data.command === "ninja-app-command" || event.data.type)) {
        const data = event.data;
        const { type, payload, signature } = data;
        
        if (type === "connection-response") {
          if (payload.anonymous) {
            setIsAnonymous(true);
            listener(data);
            return;
          }

          const publicKeyHex = payload.wallet.publicKeyHex;
          const verification = verifySignature(payload, signature, publicKeyHex);
          
          if (verification.valid) {
            if (!initiatorPublicKeyRef.current) {
              setInitiatorAddress(payload.wallet.address);
              setInitiatorPublicKey(publicKeyHex);
              setRootPrincipal(payload.wallet.rootPrincipal || null);
              setIcDelegation(payload.icDelegation);
              const identity = buildIdentityFromPackage(data.icIdentityPackage);
              setIcIdentity(identity);
              setConnectionData(data);
              setGenericUseSeed(data.genericUseSeed);
              if (data.icIdentityPackage.expirationDate) {
                setDelegationExpirationDate(new Date(data.icIdentityPackage.expirationDate));
              }
              // Update last connection time on successful connection
              updateLastConnectionTime();
            } else {
              // If already connected, just refresh the identity and timestamp
              const identity = buildIdentityFromPackage(data.icIdentityPackage);
              setIcIdentity(identity);
              setConnectionData(data);
              setGenericUseSeed(data.genericUseSeed);
              if (data.icIdentityPackage.expirationDate) {
                setDelegationExpirationDate(new Date(data.icIdentityPackage.expirationDate));
              }
              updateLastConnectionTime();
              console.log('Connection refreshed');
            }
            listener(data);
          } else {
            console.error("connection-response verification failed", { data });
          }
        } else if (type === "pay-response") {
          if (initiatorPublicKeyRef.current && verifySignature(payload, signature, initiatorPublicKeyRef.current).valid) {
            listener(data);
          } else {
            console.error(`Payment response signature invalid`, { payload, signature });
          }
        } else {
          if (initiatorPublicKeyRef.current && verifySignature(payload, signature, initiatorPublicKeyRef.current).valid) {
            listener(data);
          } else {
            console.error(`Message signature invalid for type ${type}`, { payload, signature });
          }
        }
      }
    };
    
    messageHandlers.current.set(listener, handler);
    window.addEventListener('message', handler);
  };

  const offCommand = (listener) => {
    const handler = messageHandlers.current.get(listener);
    if (handler) {
      window.removeEventListener('message', handler);
      messageHandlers.current.delete(listener);
    }
  };

  // Listen for connection responses from parent
  useEffect(() => {
    const handleConnectionResponse = (data) => {
      console.log('Connection response received:', data);
    };
    
    onCommand(handleConnectionResponse);
    
    return () => {
      offCommand(handleConnectionResponse);
    };
  }, []);

  // Auto-connect on mount and retry every 1 second until we get wallet address
  useEffect(() => {
    // Request connection immediately on mount
    sendCommand({ type: "connection", navbg:"#9333ea" });

    // Set up interval to retry every 1 second until we have wallet address
    const retryInterval = setInterval(() => {
      if (!initiatorAddress) {
        console.log('Retrying connection...');
        sendCommand({ type: "connection", navbg:"#9333ea" });
      }
    }, 1000);

    // Cleanup interval when we get the wallet address or component unmounts
    if (initiatorAddress) {
      clearInterval(retryInterval);
    }

    return () => {
      clearInterval(retryInterval);
    };
  }, [initiatorAddress]);

  // Helper function to request connection from parent platform
  const requestConnection = () => {
    sendCommand({
      type: "connection"
    });
  };

  // Helper function to request ckUSDC payment
  const requestCkUSDCPayment = (amount, recipientPrincipal, note = "", ref = null) => {
    if (!icIdentity) {
      throw new Error('ICP identity not available');
    }
    
    const paymentRef = ref || `ckusdc_${Date.now()}`;
    
    const payObj = {
      type: "pay",
      ref: paymentRef,
      token: {
        protocol: "ICP",
        specification: {
          ledgerId: CK_USDC_LEDGER
        }
      },
      recipients: [
        {
          address: recipientPrincipal,
          value: amount,
          note: note
        }
      ]
    };
    console.log('Requesting ckUSDC payment:', payObj);
    sendCommand(payObj);
    return paymentRef;
  };

  // Helper function to get ckUSDC balance
  // principalText: optional principal to query (defaults to icIdentity.getPrincipal())
  // subaccountHex: optional subaccount hex string (defaults to default subaccount)
  const getBalance = async (principalText = null, subaccountHex = null) => {
    if (!icIdentity) {
      console.error('getBalance: ICP identity not available');
      throw new Error('ICP identity not available');
    }

    try {
      const agent = new HttpAgent({ 
        identity: icIdentity,
        host: 'https://ic0.app'
      });

      // ICRC-1 ledger IDL
      const ledgerIdl = ({ IDL }) => {
        const Account = IDL.Record({
          owner: IDL.Principal,
          subaccount: IDL.Opt(IDL.Vec(IDL.Nat8))
        });
        return IDL.Service({
          icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ['query'])
        });
      };

      console.log('getBalance: Creating ledger actor for canister:', CK_USDC_LEDGER);
      const ledgerActor = Actor.createActor(ledgerIdl, {
        agent,
        canisterId: CK_USDC_LEDGER
      });

      // Use provided principal or default to user's principal
      const principal = principalText 
        ? (typeof principalText === 'string' ? Principal.fromText(principalText) : principalText)
        : icIdentity.getPrincipal();
      
      console.log('getBalance: Querying for principal:', principal.toText());
      
      // Convert hex subaccount string to Uint8Array if provided
      let subaccount = [];
      if (subaccountHex && subaccountHex.length > 0) {
        // Remove '0x' prefix if present
        const hex = subaccountHex.startsWith('0x') ? subaccountHex.slice(2) : subaccountHex;
        // Convert hex string to byte array (must be exactly 32 bytes)
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
          bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        // Ensure it's exactly 32 bytes
        while (bytes.length < 32) {
          bytes.unshift(0);
        }
        subaccount = [new Uint8Array(bytes)];
        console.log('getBalance: Using subaccount:', hex, '-> bytes:', bytes.length);
      }
      
      console.log('getBalance: Querying balance for principal:', principal.toText(), 'with subaccount:', subaccount.length > 0 ? 'custom' : 'default');
      
      const balance = await ledgerActor.icrc1_balance_of({
        owner: principal,
        subaccount: subaccount
      });

      const formattedBalance = (Number(balance) / 1_000_000).toFixed(6);
      console.log('getBalance: Raw balance:', balance.toString(), 'Formatted:', formattedBalance);
      
      // ckUSDC has 6 decimals - return as number for easier comparison
      return parseFloat(formattedBalance);
    } catch (error) {
      console.error('getBalance: Error fetching ckUSDC balance:', error);
      throw error;
    }
  };

  // Helper function to transfer ckUSDC to canister's user subaccount
  // This is used before calling create_order to pre-fund the order
  const transferCkUSDC = async (amountUSD) => {
    if (!icIdentity) {
      console.error('transferCkUSDC: ICP identity not available');
      throw new Error('ICP identity not available');
    }

    if (!canisterId) {
      console.error('transferCkUSDC: Canister ID not available');
      throw new Error('Canister ID not available');
    }

    try {
      const agent = new HttpAgent({ 
        identity: icIdentity,
        host: 'https://ic0.app'
      });

      // ICRC-1 ledger IDL
      const ledgerIdl = ({ IDL }) => {
        const Account = IDL.Record({
          owner: IDL.Principal,
          subaccount: IDL.Opt(IDL.Vec(IDL.Nat8))
        });
        const TransferArg = IDL.Record({
          to: Account,
          amount: IDL.Nat,
          fee: IDL.Opt(IDL.Nat),
          memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
          from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
          created_at_time: IDL.Opt(IDL.Nat64)
        });
        const TransferError = IDL.Variant({
          BadFee: IDL.Record({ expected_fee: IDL.Nat }),
          BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
          InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
          TooOld: IDL.Null,
          CreatedInFuture: IDL.Record({ ledger_time: IDL.Nat64 }),
          Duplicate: IDL.Record({ duplicate_of: IDL.Nat }),
          TemporarilyUnavailable: IDL.Null,
          GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text })
        });
        const TransferResult = IDL.Variant({
          Ok: IDL.Nat,
          Err: TransferError
        });
        return IDL.Service({
          icrc1_transfer: IDL.Func([TransferArg], [TransferResult], [])
        });
      };

      console.log('transferCkUSDC: Creating ledger actor for canister:', CK_USDC_LEDGER);
      const ledgerActor = Actor.createActor(ledgerIdl, {
        agent,
        canisterId: CK_USDC_LEDGER
      });

      // Convert amount to e6 (ckUSDC has 6 decimals)
      const amountE6 = BigInt(Math.floor(amountUSD * 1_000_000));
      
      // Derive user's subaccount from their principal
      // User subaccount = SHA256(principal_bytes)
      const userPrincipal = icIdentity.getPrincipal();
      const principalBytes = userPrincipal.toUint8Array();
      
      // Calculate SHA256 hash of the principal bytes directly
      // crypto-js expects a WordArray, create it from bytes
      const wordArray = CryptoJS.lib.WordArray.create(principalBytes);
      const hashWordArray = SHA256(wordArray);
      const hashHex = hashWordArray.toString(CryptoJS.enc.Hex);
      
      // Convert hex to 32-byte array
      const subaccountBytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        subaccountBytes[i] = parseInt(hashHex.substr(i * 2, 2), 16);
      }

      console.log('transferCkUSDC: Transferring', amountUSD, 'ckUSDC to canister user subaccount');
      console.log('transferCkUSDC: User principal:', userPrincipal.toText());
      console.log('transferCkUSDC: Target canister:', canisterId);
      console.log('transferCkUSDC: User subaccount:', hashHex);

      const transferResult = await ledgerActor.icrc1_transfer({
        to: { 
          owner: Principal.fromText(canisterId), 
          subaccount: [Array.from(subaccountBytes)]
        },
        amount: amountE6,
        fee: [],
        memo: [],
        from_subaccount: [],
        created_at_time: []
      });

      if ('Err' in transferResult) {
        const errorKey = Object.keys(transferResult.Err)[0];
        const errorValue = transferResult.Err[errorKey];
        console.error('transferCkUSDC: Transfer failed:', errorKey, errorValue);
        throw new Error(`Transfer failed: ${errorKey}${errorValue ? `: ${JSON.stringify(errorValue)}` : ''}`);
      }

      const blockIndex = transferResult.Ok.toString();
      console.log('transferCkUSDC: Transfer successful, block index:', blockIndex);
      return blockIndex;
    } catch (error) {
      console.error('transferCkUSDC: Error transferring ckUSDC:', error);
      throw error;
    }
  };

  const sdk = {
    sendCommand,
    onCommand,
    offCommand,
    initiatorAddress,
    initiatorPublicKey,
    rootPrincipal,
    connectionData,
    genericUseSeed,
    icIdentity,
    actor,
    canisterId,
    isAnonymous,
    isAuthenticated: !!icIdentity && !!initiatorAddress,
    requestConnection,
    requestCkUSDCPayment,
    getBalance,
    transferCkUSDC,
    disconnect: () => {
      setIcIdentity(null);
      setInitiatorAddress(null);
      setInitiatorPublicKey(null);
      setRootPrincipal(null);
      setConnectionData(null);
      setActor(null);
      setIsAnonymous(false);
      setDelegationExpirationDate(null);
    },
    userPrincipal: icIdentity ? icIdentity.getPrincipal().toText() : null
  };

  return (
    <SDKContext.Provider value={sdk}>
      {children}
    </SDKContext.Provider>
  );
};
