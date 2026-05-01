import { describe, it, expect } from 'vitest';
import { extractGrpcContracts, type GrpcContract } from '../../groups/grpc-extractor.js';

const PROTO_SOURCE = `
syntax = "proto3";
package payments;

service PaymentService {
  rpc ProcessPayment (PaymentRequest) returns (PaymentResponse);
  rpc RefundPayment (RefundRequest) returns (RefundResponse);
}

message PaymentRequest { string amount = 1; }
message PaymentResponse { bool success = 1; }
`;

const GO_GRPC_SOURCE = `
conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
client := pb.NewPaymentServiceClient(conn)
resp, err := client.ProcessPayment(ctx, req)
`;

describe('extractGrpcContracts', () => {
  it('extracts service definitions from proto files', () => {
    const result = extractGrpcContracts(PROTO_SOURCE, '/api.proto');
    const services = result.filter(c => c.role === 'provider');
    expect(services.some(s => s.serviceName === 'PaymentService')).toBe(true);
  });

  it('extracts RPC method names', () => {
    const result = extractGrpcContracts(PROTO_SOURCE, '/api.proto');
    const methods = result.flatMap(c => c.methods);
    expect(methods).toContain('ProcessPayment');
    expect(methods).toContain('RefundPayment');
  });

  it('detects consumer pattern in Go gRPC client code', () => {
    const result = extractGrpcContracts(GO_GRPC_SOURCE, '/client.go');
    const consumers = result.filter(c => c.role === 'consumer');
    expect(consumers.length).toBeGreaterThan(0);
  });

  it('returns empty for unrelated source', () => {
    const result = extractGrpcContracts('const x = 1;', '/utils.ts');
    expect(result).toHaveLength(0);
  });
});
