export class UploadCertificateDto {
  domains: string[]; // Array of domain names
  certPem: string; // PEM-encoded certificate
  keyPem: string; // PEM-encoded private key
  chainPem?: string; // Optional PEM-encoded certificate chain
}
