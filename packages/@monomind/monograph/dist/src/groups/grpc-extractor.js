// Proto: service definition
// Matches service bodies up to one level of nested braces (covers rpc Foo() returns (Bar) {})
const PROTO_SERVICE_RE = /\bservice\s+(\w+)\s*\{((?:[^{}]|\{[^}]*\})*)\}/gs;
const PROTO_RPC_RE = /\brpc\s+(\w+)\s*\(/g;
const PROTO_PACKAGE_RE = /^package\s+([\w.]+);/m;
// Consumer patterns
const GO_CLIENT_RE = /\bNew(\w+)Client\s*\(/g;
const NODE_CLIENT_RE = /new\s+(\w+)Client\s*\(/g;
const PYTHON_STUB_RE = /\bpb2_grpc\.(\w+)Stub\s*\(/g;
const JAVA_CLIENT_RE = /(\w+)Grpc\.new\w+Stub\s*\(/g;
export function extractGrpcContracts(source, filePath) {
    const results = [];
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'proto') {
        const packageMatch = PROTO_PACKAGE_RE.exec(source);
        const packageName = packageMatch?.[1];
        PROTO_SERVICE_RE.lastIndex = 0;
        let m;
        while ((m = PROTO_SERVICE_RE.exec(source)) !== null) {
            const serviceName = m[1];
            const body = m[2];
            const methods = [];
            PROTO_RPC_RE.lastIndex = 0;
            let rpc;
            while ((rpc = PROTO_RPC_RE.exec(body)) !== null) {
                methods.push(rpc[1]);
            }
            results.push({ serviceName, role: 'provider', methods, filePath, packageName });
        }
        return results;
    }
    // Consumer detection by file type
    const consumerPatterns = [];
    if (ext === 'go')
        consumerPatterns.push([GO_CLIENT_RE, 'Service']);
    else if (['ts', 'js', 'mjs'].includes(ext))
        consumerPatterns.push([NODE_CLIENT_RE, 'Service']);
    else if (ext === 'py')
        consumerPatterns.push([PYTHON_STUB_RE, '']);
    else if (['java', 'kt'].includes(ext))
        consumerPatterns.push([JAVA_CLIENT_RE, '']);
    for (const [re, suffix] of consumerPatterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(source)) !== null) {
            const name = m[1] + suffix;
            results.push({ serviceName: name, role: 'consumer', methods: [], filePath });
        }
    }
    return results;
}
//# sourceMappingURL=grpc-extractor.js.map