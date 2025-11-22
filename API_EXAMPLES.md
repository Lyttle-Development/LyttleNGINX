# API Usage Examples

Complete examples for using the TLS/SSL API endpoints.

## Table of Contents

1. [Certificate Management](#certificate-management)
2. [TLS Configuration](#tls-configuration)
3. [TypeScript/JavaScript Examples](#typescriptjavascript-examples)
4. [Python Examples](#python-examples)
5. [Automated Scripts](#automated-scripts)

---

## Certificate Management

### List All Certificates

```bash
curl http://localhost:3000/certificates
```

Response:

```json
[
  {
    "id": "uuid-1234",
    "domains": [
      "example.com",
      "www.example.com"
    ],
    "expiresAt": "2025-02-20T00:00:00.000Z",
    "issuedAt": "2024-11-22T00:00:00.000Z",
    "lastUsedAt": "2024-11-22T10:30:00.000Z",
    "isOrphaned": false,
    "daysUntilExpiry": 90,
    "status": "valid"
  }
]
```

### Get Certificate Details

```bash
curl http://localhost:3000/certificates/uuid-1234
```

### Upload Custom Certificate

```bash
# From files
curl -X POST http://localhost:3000/certificates/upload \
  -H "Content-Type: application/json" \
  -d @- << EOF
{
  "domains": ["api.example.com", "www.api.example.com"],
  "certPem": "$(cat /path/to/certificate.pem | sed 's/$/\\n/' | tr -d '\n')",
  "keyPem": "$(cat /path/to/private-key.pem | sed 's/$/\\n/' | tr -d '\n')",
  "chainPem": "$(cat /path/to/chain.pem | sed 's/$/\\n/' | tr -d '\n')"
}
EOF
```

Or directly:

```bash
curl -X POST http://localhost:3000/certificates/upload \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["example.com"],
    "certPem": "-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----",
    "keyPem": "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
    "chainPem": "-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----"
  }'
```

### Generate Self-Signed Certificate

```bash
curl -X POST http://localhost:3000/certificates/generate-self-signed \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["localhost", "*.localhost", "dev.local"]
  }'
```

### Renew Specific Certificate

```bash
curl -X POST http://localhost:3000/certificates/renew/uuid-1234
```

### Renew All Certificates

```bash
curl -X POST http://localhost:3000/certificates/renew-all
```

Response:

```json
{
  "message": "Certificate renewal process initiated"
}
```

### Delete Certificate

```bash
curl -X DELETE http://localhost:3000/certificates/uuid-1234
```

### Validate Domain

```bash
curl http://localhost:3000/certificates/validate/example.com
```

Response:

```json
{
  "domain": "example.com",
  "valid": true,
  "message": "Domain resolves successfully"
}
```

---

## TLS Configuration

### Get Recommended TLS Config

```bash
curl http://localhost:3000/tls/config/example.com
```

Response:

```json
{
  "protocols": [
    "TLSv1.2",
    "TLSv1.3"
  ],
  "cipherSuites": "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256...",
  "hsts": true,
  "ocspStapling": true
}
```

### Test TLS Connection

```bash
curl http://localhost:3000/tls/test/example.com
```

Response:

```json
{
  "success": true,
  "protocol": "TLSv1.3",
  "cipher": "TLS_AES_256_GCM_SHA384"
}
```

### Generate DH Parameters

```bash
# 2048-bit (faster, ~2-5 minutes)
curl -X POST http://localhost:3000/tls/dhparam \
  -H "Content-Type: application/json" \
  -d '{"bits": 2048}'

# 4096-bit (stronger, ~10-30 minutes)
curl -X POST http://localhost:3000/tls/dhparam \
  -H "Content-Type: application/json" \
  -d '{"bits": 4096}'
```

Response:

```json
{
  "message": "DH parameter generation started in background",
  "note": "This may take several minutes"
}
```

### Check DH Parameters Status

```bash
curl http://localhost:3000/tls/dhparam/status
```

Response:

```json
{
  "exists": true,
  "path": "/etc/nginx/ssl/dhparam.pem"
}
```

### Get Certificate Info from PEM

```bash
curl -X POST http://localhost:3000/tls/certificate/info \
  -H "Content-Type: application/json" \
  -d '{
    "certPem": "-----BEGIN CERTIFICATE-----\nMIIF...\n-----END CERTIFICATE-----"
  }'
```

Response:

```json
{
  "subject": "CN=example.com",
  "issuer": "CN=Let's Encrypt Authority X3, O=Let's Encrypt, C=US",
  "validFrom": "2024-11-22T00:00:00.000Z",
  "validTo": "2025-02-20T23:59:59.000Z",
  "serialNumber": "03:e7:...",
  "subjectAltNames": [
    "example.com",
    "www.example.com"
  ]
}
```

### Validate Certificate Chain

```bash
curl -X POST http://localhost:3000/tls/certificate/validate-chain \
  -H "Content-Type: application/json" \
  -d '{
    "certPem": "-----BEGIN CERTIFICATE-----\n...",
    "chainPem": "-----BEGIN CERTIFICATE-----\n..."
  }'
```

Response:

```json
{
  "valid": true
}
```

---

## TypeScript/JavaScript Examples

### Node.js/TypeScript Client

```typescript
import axios from 'axios';

const API_BASE = 'http://localhost:3000';

interface Certificate {
    id: string;
    domains: string[];
    expiresAt: Date;
    issuedAt: Date;
    lastUsedAt: Date;
    isOrphaned: boolean;
    daysUntilExpiry: number;
    status: 'valid' | 'expiring_soon' | 'expired';
}

class CertificateClient {
    private baseUrl: string;

    constructor(baseUrl: string = API_BASE) {
        this.baseUrl = baseUrl;
    }

    async listCertificates(): Promise<Certificate[]> {
        const response = await axios.get(`${this.baseUrl}/certificates`);
        return response.data;
    }

    async getCertificate(id: string): Promise<Certificate> {
        const response = await axios.get(`${this.baseUrl}/certificates/${id}`);
        return response.data;
    }

    async uploadCertificate(data: {
        domains: string[];
        certPem: string;
        keyPem: string;
        chainPem?: string;
    }): Promise<Certificate> {
        const response = await axios.post(
            `${this.baseUrl}/certificates/upload`,
            data
        );
        return response.data;
    }

    async generateSelfSigned(domains: string[]): Promise<Certificate> {
        const response = await axios.post(
            `${this.baseUrl}/certificates/generate-self-signed`,
            {domains}
        );
        return response.data;
    }

    async renewCertificate(id: string): Promise<{ message: string }> {
        const response = await axios.post(
            `${this.baseUrl}/certificates/renew/${id}`
        );
        return response.data;
    }

    async renewAllCertificates(): Promise<{ message: string }> {
        const response = await axios.post(
            `${this.baseUrl}/certificates/renew-all`
        );
        return response.data;
    }

    async deleteCertificate(id: string): Promise<void> {
        await axios.delete(`${this.baseUrl}/certificates/${id}`);
    }

    async validateDomain(domain: string): Promise<{
        domain: string;
        valid: boolean;
        message: string;
    }> {
        const response = await axios.get(
            `${this.baseUrl}/certificates/validate/${domain}`
        );
        return response.data;
    }

    async testTlsConnection(domain: string): Promise<{
        success: boolean;
        protocol?: string;
        cipher?: string;
        error?: string;
    }> {
        const response = await axios.get(`${this.baseUrl}/tls/test/${domain}`);
        return response.data;
    }
}

// Usage
async function main() {
    const client = new CertificateClient();

    // List all certificates
    const certs = await client.listCertificates();
    console.log('Certificates:', certs);

    // Check for expiring certificates
    const expiring = certs.filter(c => c.status === 'expiring_soon');
    console.log('Expiring soon:', expiring);

    // Generate self-signed cert
    const selfSigned = await client.generateSelfSigned(['test.local']);
    console.log('Generated:', selfSigned);

    // Validate domain
    const validation = await client.validateDomain('example.com');
    console.log('Domain valid:', validation.valid);
}

main().catch(console.error);
```

### React Hook Example

```typescript
import {useState, useEffect} from 'react';
import axios from 'axios';

interface Certificate {
    id: string;
    domains: string[];
    expiresAt: string;
    daysUntilExpiry: number;
    status: 'valid' | 'expiring_soon' | 'expired';
}

export function useCertificates(baseUrl: string = 'http://localhost:3000') {
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchCertificates = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${baseUrl}/certificates`);
            setCertificates(response.data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCertificates();
        const interval = setInterval(fetchCertificates, 60000); // Refresh every minute
        return () => clearInterval(interval);
    }, []);

    return {certificates, loading, error, refresh: fetchCertificates};
}

// Component usage
function CertificateList() {
    const {certificates, loading, error} = useCertificates();

    if (loading) return <div>Loading
...
    </div>;
    if (error) return <div>Error
:
    {
        error
    }
    </div>;

    return (
        <div>
            {
                certificates.map(cert => (
                    <div key = {cert.id} >
                        <h3>{cert.domains.join(', ')} < /h3>
                        < p > Status
:
    {
        cert.status
    }
    </p>
    < p > Expires in {cert.daysUntilExpiry}
    days < /p>
    < /div>
))
}
    </div>
)
    ;
}
```

---

## Python Examples

### Python Client

```python
import requests
from typing import List, Dict, Optional
from datetime import datetime

class CertificateClient:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
    
    def list_certificates(self) -> List[Dict]:
        response = requests.get(f"{self.base_url}/certificates")
        response.raise_for_status()
        return response.json()
    
    def get_certificate(self, cert_id: str) -> Dict:
        response = requests.get(f"{self.base_url}/certificates/{cert_id}")
        response.raise_for_status()
        return response.json()
    
    def upload_certificate(
        self,
        domains: List[str],
        cert_pem: str,
        key_pem: str,
        chain_pem: Optional[str] = None
    ) -> Dict:
        data = {
            "domains": domains,
            "certPem": cert_pem,
            "keyPem": key_pem
        }
        if chain_pem:
            data["chainPem"] = chain_pem
        
        response = requests.post(
            f"{self.base_url}/certificates/upload",
            json=data
        )
        response.raise_for_status()
        return response.json()
    
    def generate_self_signed(self, domains: List[str]) -> Dict:
        response = requests.post(
            f"{self.base_url}/certificates/generate-self-signed",
            json={"domains": domains}
        )
        response.raise_for_status()
        return response.json()
    
    def renew_certificate(self, cert_id: str) -> Dict:
        response = requests.post(
            f"{self.base_url}/certificates/renew/{cert_id}"
        )
        response.raise_for_status()
        return response.json()
    
    def delete_certificate(self, cert_id: str) -> None:
        response = requests.delete(
            f"{self.base_url}/certificates/{cert_id}"
        )
        response.raise_for_status()

# Usage
if __name__ == "__main__":
    client = CertificateClient()
    
    # List certificates
    certs = client.list_certificates()
    print(f"Found {len(certs)} certificates")
    
    # Check expiring
    expiring = [c for c in certs if c["status"] == "expiring_soon"]
    if expiring:
        print(f"⚠️  {len(expiring)} certificate(s) expiring soon!")
        for cert in expiring:
            print(f"  - {cert['domains'][0]}: {cert['daysUntilExpiry']} days")
    
    # Generate self-signed
    test_cert = client.generate_self_signed(["test.local", "*.test.local"])
    print(f"Generated certificate: {test_cert['id']}")
```

---

## Automated Scripts

### Certificate Health Check Script

```bash
#!/bin/bash
# check-certs.sh - Monitor certificate health

API_URL="http://localhost:3000"
ALERT_DAYS=14

# Get all certificates
CERTS=$(curl -s "$API_URL/certificates")

# Parse and check
echo "$CERTS" | jq -r '.[] | select(.daysUntilExpiry <= '$ALERT_DAYS') | 
  "⚠️  \(.domains[0]) expires in \(.daysUntilExpiry) days (Status: \(.status))"'

# Check if any are expired
EXPIRED=$(echo "$CERTS" | jq -r '.[] | select(.status == "expired") | .domains[0]')
if [ -n "$EXPIRED" ]; then
  echo "🚨 EXPIRED CERTIFICATES:"
  echo "$EXPIRED"
  exit 1
fi
```

### Auto-Renewal Script

```bash
#!/bin/bash
# auto-renew.sh - Automatically renew expiring certificates

API_URL="http://localhost:3000"
RENEW_THRESHOLD=30

echo "Checking certificates..."

# Get certificates expiring within threshold
EXPIRING=$(curl -s "$API_URL/certificates" | \
  jq -r ".[] | select(.daysUntilExpiry <= $RENEW_THRESHOLD and .status != \"expired\") | .id")

if [ -z "$EXPIRING" ]; then
  echo "✓ No certificates need renewal"
  exit 0
fi

echo "Found certificates needing renewal:"
echo "$EXPIRING"

# Renew each
while IFS= read -r cert_id; do
  echo "Renewing $cert_id..."
  curl -X POST "$API_URL/certificates/renew/$cert_id"
done <<< "$EXPIRING"

echo "✓ Renewal process completed"
```

### Backup Script

```bash
#!/bin/bash
# backup-certs.sh - Export all certificates

API_URL="http://localhost:3000"
BACKUP_DIR="./cert-backups/$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "Fetching certificates..."
curl -s "$API_URL/certificates" > "$BACKUP_DIR/certificates.json"

echo "Certificate list backed up to: $BACKUP_DIR/certificates.json"
echo "✓ Backup complete"
```

### Slack Notification Script

```bash
#!/bin/bash
# notify-slack.sh - Send certificate alerts to Slack

API_URL="http://localhost:3000"
SLACK_WEBHOOK="https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
ALERT_DAYS=14

# Get expiring certificates
EXPIRING=$(curl -s "$API_URL/certificates" | \
  jq -r ".[] | select(.daysUntilExpiry <= $ALERT_DAYS)")

if [ -z "$EXPIRING" ]; then
  exit 0
fi

# Format message
MESSAGE=$(echo "$EXPIRING" | jq -r '
  "⚠️ Certificate Alert\n" +
  "Domain: \(.domains[0])\n" +
  "Expires in: \(.daysUntilExpiry) days\n" +
  "Status: \(.status)\n" +
  "Expiry: \(.expiresAt)"
')

# Send to Slack
curl -X POST "$SLACK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$MESSAGE\"}"
```

### Cron Jobs

Add to crontab (`crontab -e`):

```cron
# Check certificate health daily at 9 AM
0 9 * * * /path/to/check-certs.sh

# Auto-renew certificates daily at 2 AM
0 2 * * * /path/to/auto-renew.sh

# Backup certificates weekly on Sunday at 3 AM
0 3 * * 0 /path/to/backup-certs.sh

# Send Slack alerts daily at 10 AM
0 10 * * * /path/to/notify-slack.sh
```

---

## Integration Examples

### GitHub Actions Workflow

```yaml
name: Certificate Check

on:
  schedule:
    - cron: '0 9 * * *'  # Daily at 9 AM
  workflow_dispatch:

jobs:
  check-certificates:
    runs-on: ubuntu-latest
    steps:
      - name: Check Certificate Health
        run: |
          RESPONSE=$(curl -s ${{ secrets.API_URL }}/certificates)
          EXPIRING=$(echo "$RESPONSE" | jq '[.[] | select(.daysUntilExpiry <= 30)] | length')

          if [ "$EXPIRING" -gt 0 ]; then
            echo "::warning::$EXPIRING certificate(s) expiring within 30 days"
          fi

          EXPIRED=$(echo "$RESPONSE" | jq '[.[] | select(.status == "expired")] | length')

          if [ "$EXPIRED" -gt 0 ]; then
            echo "::error::$EXPIRED certificate(s) have expired!"
            exit 1
          fi
```

### Ansible Playbook

```yaml
---
- name: Manage SSL Certificates
  hosts: localhost
  tasks:
    - name: Get certificate list
      uri:
        url: "http://localhost:3000/certificates"
        method: GET
      register: certificates

    - name: Display expiring certificates
      debug:
        msg: "{{ item.domains[0] }} expires in {{ item.daysUntilExpiry }} days"
      loop: "{{ certificates.json }}"
      when: item.daysUntilExpiry <= 30

    - name: Renew expiring certificates
      uri:
        url: "http://localhost:3000/certificates/renew/{{ item.id }}"
        method: POST
      loop: "{{ certificates.json }}"
      when: item.daysUntilExpiry <= 30
```

---

## Troubleshooting

### Debug Certificate Issues

```bash
# Get detailed certificate info
CERT_ID="your-cert-id"
curl -s http://localhost:3000/certificates/$CERT_ID | jq

# Test TLS connection
curl http://localhost:3000/tls/test/example.com | jq

# Validate domain
curl http://localhost:3000/certificates/validate/example.com | jq

# Check application logs
docker-compose logs -f app | grep -i cert
```

### Manual Certificate Renewal

```bash
# Force renewal of specific certificate
curl -X POST http://localhost:3000/certificates/renew/CERT_ID

# Force renewal of all certificates
curl -X POST http://localhost:3000/certificates/renew-all
```

