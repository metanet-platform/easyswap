import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { ec as EC } from 'elliptic';
import SHA256 from 'crypto-js/sha256';
import { Actor, HttpAgent, AnonymousIdentity } from '@dfinity/agent';
import { DelegationIdentity, DelegationChain, Ed25519KeyIdentity } from '@dfinity/identity';
import { Buffer } from 'buffer';

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
    const CK_USDC_LEDGER = "xevnm-gaaaa-aaaar-qafnq-cai";
    
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
  const getBalance = async (subaccountHex = null) => {
    if (!icIdentity) {
      console.error('getBalance: ICP identity not available');
      throw new Error('ICP identity not available');
    }

    try {
      const CK_USDC_LEDGER = "xevnm-gaaaa-aaaar-qafnq-cai";
      console.log('getBalance: Creating agent for principal:', icIdentity.getPrincipal().toText());
      
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

      const principal = icIdentity.getPrincipal();
      
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
