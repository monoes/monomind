import { describe, it, expect } from 'vitest';
import { extractNamedBindings } from '../../parsers/named-bindings.js';

describe('extractNamedBindings', () => {
  it('extracts TypeScript class decorators', () => {
    const source = `
@Controller('/api')
export class UserController {
  @Get('/users')
  list() {}

  @Post('/users')
  create() {}
}`;
    const bindings = extractNamedBindings(source, '/app/user.controller.ts', 'typescript');
    const names = bindings.map(b => b.decoratorName);
    expect(names).toContain('Controller');
    expect(names).toContain('Get');
    expect(names).toContain('Post');
  });

  it('extracts Python function decorators', () => {
    const source = `
@app.route('/users', methods=['GET'])
def list_users():
    pass

@login_required
def profile():
    pass`;
    const bindings = extractNamedBindings(source, '/app/views.py', 'python');
    const names = bindings.map(b => b.decoratorName);
    expect(names).toContain('app.route');
    expect(names).toContain('login_required');
  });

  it('extracts Java annotations', () => {
    const source = `
@RestController
@RequestMapping("/api")
public class UserApi {
  @GetMapping("/users")
  public List<User> list() { return null; }
}`;
    const bindings = extractNamedBindings(source, '/src/UserApi.java', 'java');
    const names = bindings.map(b => b.decoratorName);
    expect(names).toContain('RestController');
    expect(names).toContain('RequestMapping');
    expect(names).toContain('GetMapping');
  });

  it('returns empty for source with no decorators', () => {
    const source = 'function plain() { return 1; }';
    const bindings = extractNamedBindings(source, '/app/plain.ts', 'typescript');
    expect(bindings).toEqual([]);
  });

  it('includes line number in result', () => {
    const source = '\n\n@Injectable()\nexport class Service {}';
    const bindings = extractNamedBindings(source, '/app/svc.ts', 'typescript');
    const inj = bindings.find(b => b.decoratorName === 'Injectable');
    expect(inj).toBeDefined();
    expect(inj!.line).toBe(3);
  });

  it('extracts decorator arguments', () => {
    const source = `@Module({ imports: [AuthModule] })\nexport class AppModule {}`;
    const bindings = extractNamedBindings(source, '/app.module.ts', 'typescript');
    const mod = bindings.find(b => b.decoratorName === 'Module');
    expect(mod).toBeDefined();
    expect(mod!.hasArguments).toBe(true);
  });
});
