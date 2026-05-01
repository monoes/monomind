import { describe, it, expect } from 'vitest';
import { extractCsharpNamespaces } from '../../../pipeline/phases/parse.js';

const CSHARP_SOURCE = `
namespace MyApp.Services {
  public class PaymentService {
    public void Process() {}
  }
}

namespace MyApp.Models {
  public class Order {}
}
`;

describe('C# namespace extraction', () => {
  it('extracts namespace declarations', () => {
    const result = extractCsharpNamespaces(CSHARP_SOURCE, '/PaymentService.cs');
    const names = result.map(n => n.name);
    expect(names).toContain('MyApp.Services');
    expect(names).toContain('MyApp.Models');
  });

  it('returns Namespace label', () => {
    const result = extractCsharpNamespaces(CSHARP_SOURCE, '/PaymentService.cs');
    expect(result.every(n => n.label === 'Namespace')).toBe(true);
  });

  it('returns correct file path', () => {
    const result = extractCsharpNamespaces(CSHARP_SOURCE, '/PaymentService.cs');
    expect(result.every(n => n.filePath === '/PaymentService.cs')).toBe(true);
  });
});
