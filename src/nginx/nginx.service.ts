// ...existing imports
import * as fs from "fs";
// ...other imports

// Template for server and location config generation
function getNginxServerBlock(entry: EntryType) {
    const domains = entry.domains
        .split(';')
        .map((d) => d.trim())
        .map((d) => d.replace(/^\*/, '').trim())
        .filter(Boolean);
    if (domains.length === 0) return "";

    const primaryDomain = domains[0];
    const certPath = `/etc/letsencrypt/live/${primaryDomain}/fullchain.pem`;
    const keyPath = `/etc/letsencrypt/live/${primaryDomain}/privkey.pem`;
    const hasCert = fs.existsSync(certPath) && fs.existsSync(keyPath);

    // Explicit header forwarding for location block
    const proxyHeaders = `
        proxy_pass_request_headers on;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_set_header Forwarded         "for=$remote_addr;proto=$scheme;host=$host";
        proxy_set_header X-Forwarded-Scheme $scheme;
        proxy_set_header Accept-Encoding "";

        proxy_set_header CF-Connecting-IP  $http_cf_connecting_ip;
        proxy_set_header CF-IPCountry      $http_cf_ipcountry;
        proxy_set_header CF-Ray            $http_cf_ray;
        proxy_set_header CF-Visitor        $http_cf_visitor;
        proxy_set_header True-Client-IP    $http_true_client_ip;

        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
    `;

    const sslLines = hasCert && entry.ssl
        ? `
            listen 443 ssl;
            ssl_certificate ${certPath};
            ssl_certificate_key ${keyPath};
            ssl_session_cache shared:SSL:10m;
            ssl_session_timeout 10m;
        `
        : `
            listen 80;
        `;

    return `
server {
    server_name ${domains.join(" ")};
    ${sslLines}
    root /etc/nginx/html;

    location / {
        ${proxyHeaders}
        proxy_pass http://${entry.upstream};
        proxy_connect_timeout 5s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
    }
}
    `;
}

// ...rest of file unchanged