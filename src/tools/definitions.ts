/**
 * MCP Tool Definitions
 * Generated from YAML configuration for consistency
 */

import { generateMcpTools } from '../config/loader.js';

/**
 * TOOLS array is now loaded from src/config/yaml/tools.yaml
 * This provides a single source of truth for all tool metadata
 * 
 * Benefits:
 * - Descriptions defined once in YAML
 * - Easy to update without touching TypeScript
 * - Consistent format across all tools
 * - Validation rules co-located with descriptions
 */
export const TOOLS = generateMcpTools();
