// F7: the AES-256-GCM helper moved to @autoapply/db (shared with the api for Gmail tokens); old names kept.
export {
  SecretKeyError as SessionKeyError,
  secretKey as sessionKey,
  encryptSecret as encryptSession,
  decryptSecret as decryptSession,
} from '@autoapply/db';
