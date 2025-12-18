#!/usr/bin/env node

/**
 * OpenAPI Client Code Generator
 * Generates TypeScript types and API client functions from OpenAPI spec
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate TypeScript types
function generateTypes(openapiSpec) {
  let types = `// Auto-generated types from OpenAPI spec
// Generated on: ${new Date().toISOString()}

`;

  // Add component schemas
  if (openapiSpec.components?.schemas) {
    Object.entries(openapiSpec.components.schemas).forEach(([name, schema]) => {
      types += `export interface ${name} {\n`;
      if (schema.properties) {
        Object.entries(schema.properties).forEach(([propName, propSchema]) => {
          const required = schema.required?.includes(propName);
          const optional = required ? '' : '?';
          const type = getTypeScriptType(propSchema);
          types += `  ${propName}${optional}: ${type};\n`;
        });
      }
      types += '}\n\n';
    });
  }

  return types;
}

// Convert OpenAPI schema to TypeScript type
function getTypeScriptType(schema) {
  if (schema.type === 'string') {
    if (schema.format === 'date-time') return 'string';
    if (schema.format === 'email') return 'string';
    if (schema.enum) return schema.enum.map(e => `"${e}"`).join(' | ');
    return 'string';
  }
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') {
    return `${getTypeScriptType(schema.items)}[]`;
  }
  if (schema.type === 'object') {
    if (schema.properties) {
      const props = Object.entries(schema.properties)
        .map(([key, prop]) => `${key}: ${getTypeScriptType(prop)}`)
        .join('; ');
      return `{ ${props} }`;
    }
    return 'Record<string, any>';
  }
  if (schema.$ref) {
    return schema.$ref.split('/').pop();
  }
  return 'any';
}

// Generate API client functions
function generateApiClient(openapiSpec) {
  let client = `// Auto-generated API client from OpenAPI spec
// Generated on: ${new Date().toISOString()}

import type { User, StockQuote, IndexQuote, PaginatedResponse } from './types';

class TradeNextApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = \`\${this.baseUrl}\${endpoint}\`;
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(\`API request failed: \${response.status} \${response.statusText}\`);
    }

    return response.json();
  }

`;

  // Generate methods for each endpoint
  Object.entries(openapiSpec.paths).forEach(([path, methods]) => {
    Object.entries(methods).forEach(([method, config]) => {
      if (method !== 'get' && method !== 'post') return;

      const operationId = config.operationId || generateOperationId(path, method);
      const returnType = getReturnType(config.responses);

      client += `  async ${operationId}(${getParameters(path, config.parameters, method)}) {\n`;
      client += `    return this.request${returnType}(\`${path.replace(/\{([^}]+)\}/g, '${$1}')}\`, {\n`;
      client += `      method: '${method.toUpperCase()}',\n`;

      if (method === 'post' && config.requestBody) {
        client += `      headers: { 'Content-Type': 'application/json' },\n`;
        client += `      body: JSON.stringify(body),\n`;
      }

      client += `    });\n`;
      client += `  }\n\n`;
    });
  });

  client += `}

export default TradeNextApiClient;
`;

  return client;
}

// Generate operation ID from path and method
function generateOperationId(path, method) {
  const cleanPath = path.replace(/^\//, '').replace(/\/\{[^}]+\}/g, '').replace(/\//g, '_');
  return `${method}${cleanPath.charAt(0).toUpperCase() + cleanPath.slice(1)}`;
}

// Get method parameters
function getParameters(path, parameters = [], method) {
  let params = [];

  // Path parameters
  const pathParams = path.match(/\{([^}]+)\}/g);
  if (pathParams) {
    params.push(...pathParams.map(p => p.slice(1, -1) + ': string'));
  }

  // Query parameters
  if (parameters) {
    const queryParams = parameters.filter(p => p.in === 'query');
    if (queryParams.length > 0) {
      params.push('params?: Record<string, any>');
    }
  }

  // Body parameter for POST
  if (method === 'post') {
    params.push('body?: any');
  }

  return params.join(', ');
}

// Get return type from responses
function getReturnType(responses) {
  const successResponse = responses['200'] || responses['201'];
  if (successResponse?.content?.['application/json']?.schema) {
    const schema = successResponse.content['application/json'].schema;
    if (schema.$ref) {
      return `<${schema.$ref.split('/').pop()}>`;
    }
    return '<any>';
  }
  return '<any>';
}

// Main execution
async function main() {
  console.log('🔄 Generating OpenAPI client code...');

  try {
    // Import the OpenAPI spec
    console.log('📥 Importing OpenAPI spec...');
    const openapiModule = await import('../app/api/openapi/route.js');

    // Extract the openapi object by calling the GET function and awaiting its result
    const response = await openapiModule.GET();
    const openapiSpec = await response.json();

    console.log('✅ OpenAPI spec imported successfully');
    console.log('📊 Spec contains', Object.keys(openapiSpec.paths || {}).length, 'paths');
    console.log('🔍 Spec keys:', Object.keys(openapiSpec));

    const typesDir = path.join(__dirname, '..', 'lib', 'api-client');
    console.log('📁 Target directory:', typesDir);

    if (!fs.existsSync(typesDir)) {
      console.log('📁 Creating directory...');
      fs.mkdirSync(typesDir, { recursive: true });
      console.log('✅ Directory created');
    }

  // Generate types
  console.log('📝 Generating types...');
  const types = generateTypes(openapiSpec);
  console.log('📄 Types content length:', types.length);

  const typesPath = path.join(typesDir, 'types.ts');
  console.log('💾 Writing types to:', typesPath);
  fs.writeFileSync(typesPath, types);
  console.log('✅ Generated types.ts');

  // Generate client
  console.log('📝 Generating client...');
  const client = generateApiClient(openapiSpec);
  console.log('📄 Client content length:', client.length);

  const clientPath = path.join(typesDir, 'client.ts');
  console.log('💾 Writing client to:', clientPath);
  fs.writeFileSync(clientPath, client);
  console.log('✅ Generated client.ts');

  // Generate index file
  console.log('📝 Generating index...');
  const index = `// Auto-generated API client index
export { default as TradeNextApiClient } from './client';
export * from './types';
`;

  const indexPath = path.join(typesDir, 'index.ts');
  console.log('💾 Writing index to:', indexPath);
  fs.writeFileSync(indexPath, index);
  console.log('✅ Generated index.ts');

  console.log('🎉 OpenAPI client generation complete!');
  } catch (error) {
    console.error('❌ Error generating client:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { generateTypes, generateApiClient };
