import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PipelinePhase, PipelineContext } from '../types.js';

export type SupportedFramework =
  | 'react' | 'vue' | 'angular' | 'svelte'
  | 'express' | 'fastify' | 'nestjs' | 'koa'
  | 'django' | 'flask' | 'fastapi'
  | 'spring' | 'rails' | 'laravel';

export type PrimaryLanguage = 'javascript' | 'python' | 'java' | 'ruby' | 'php' | null;

export interface FrameworkDetectOutput {
  frameworks: SupportedFramework[];
  primaryLanguage: PrimaryLanguage;
  confidence: Record<SupportedFramework, number>;
}

const NPM_FRAMEWORK_MAP: Record<string, SupportedFramework> = {
  'react': 'react', 'react-dom': 'react',
  'vue': 'vue', '@vue/core': 'vue',
  '@angular/core': 'angular',
  'svelte': 'svelte',
  'express': 'express',
  'fastify': 'fastify',
  '@nestjs/core': 'nestjs',
  'koa': 'koa',
};

const PYTHON_FRAMEWORK_MAP: Record<string, SupportedFramework> = {
  'Django': 'django', 'django': 'django',
  'Flask': 'flask', 'flask': 'flask',
  'fastapi': 'fastapi', 'FastAPI': 'fastapi',
};

export function detectFrameworks(repoPath: string): FrameworkDetectOutput {
  const detected = new Map<SupportedFramework, number>();
  let primaryLanguage: PrimaryLanguage = null;

  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      for (const dep of Object.keys(allDeps)) {
        const fw = NPM_FRAMEWORK_MAP[dep];
        if (fw) {
          detected.set(fw, Math.max(detected.get(fw) ?? 0, 0.9));
          primaryLanguage = 'javascript';
        }
      }
    } catch { /* malformed JSON */ }
  }

  const reqPath = join(repoPath, 'requirements.txt');
  if (existsSync(reqPath)) {
    const lines = readFileSync(reqPath, 'utf8').split('\n');
    for (const line of lines) {
      const pkg = line.split(/[=><!]/)[0]?.trim() ?? '';
      const fw = PYTHON_FRAMEWORK_MAP[pkg];
      if (fw) {
        detected.set(fw, Math.max(detected.get(fw) ?? 0, 0.9));
        primaryLanguage = 'python';
      }
    }
  }

  const pomPath = join(repoPath, 'pom.xml');
  if (existsSync(pomPath)) {
    const pom = readFileSync(pomPath, 'utf8');
    if (pom.includes('spring-boot') || pom.includes('spring-web')) {
      detected.set('spring', Math.max(detected.get('spring') ?? 0, 0.85));
      primaryLanguage = 'java';
    }
  }

  const gemfilePath = join(repoPath, 'Gemfile');
  if (existsSync(gemfilePath)) {
    const gemfile = readFileSync(gemfilePath, 'utf8');
    if (gemfile.includes("gem 'rails'") || gemfile.includes('gem "rails"')) {
      detected.set('rails', Math.max(detected.get('rails') ?? 0, 0.9));
      primaryLanguage = 'ruby';
    }
  }

  const composerPath = join(repoPath, 'composer.json');
  if (existsSync(composerPath)) {
    try {
      const composer = JSON.parse(readFileSync(composerPath, 'utf8'));
      const reqs = { ...composer.require, ...composer['require-dev'] };
      if (reqs['laravel/framework']) {
        detected.set('laravel', Math.max(detected.get('laravel') ?? 0, 0.9));
        primaryLanguage = 'php';
      }
    } catch { /* malformed JSON */ }
  }

  const frameworks = [...detected.keys()];
  const confidence = Object.fromEntries(detected) as Record<SupportedFramework, number>;
  return { frameworks, primaryLanguage, confidence };
}

export const frameworkDetectPhase: PipelinePhase<FrameworkDetectOutput> = {
  name: 'framework-detect',
  deps: ['scan'],
  async execute(ctx: PipelineContext): Promise<FrameworkDetectOutput> {
    return detectFrameworks(ctx.repoPath);
  },
};
