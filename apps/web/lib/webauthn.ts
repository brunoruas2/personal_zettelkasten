// Helpers de conversão base64url ↔ ArrayBuffer usados pela WebAuthn API

export function base64urlToBuffer(b64: string): ArrayBuffer {
  const padded = b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '=')
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i)
  return buf.buffer
}

export function bufferToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential !==
      'undefined'
  )
}
