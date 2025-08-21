import { MCPClientComponent, MCPListToolsNode, MCPCallToolNode } from '@inworld/runtime/graph';
import { execSync } from 'child_process';

export type MCPServerId = 'brave';

interface MCPServerConfig {
  serverId: MCPServerId;
  transport: 'stdio';
  endpoint: string;
  env?: Record<string, string>;
}

function findNpxPath(): string {
  try {
    const isWin = process.platform === 'win32';
    const command = isWin ? 'where npx.cmd' : 'which npx';
    const npxPath = execSync(command, { encoding: 'utf8' }).trim();
    const firstPath = npxPath.split('\n')[0];
    return isWin ? `cmd.exe /c ${firstPath}` : firstPath;
  } catch (error) {
    console.error('❌ npx not found in PATH. Please install Node.js and npm to get npx:', error);
    throw error;
  }
}

export class MCPManager {
  private static initialized = false;
  private static started = false;
  private static configs: Map<MCPServerId, MCPServerConfig> = new Map();
  private static components: Map<MCPServerId, MCPClientComponent> = new Map();

  static initFromEnv(): void {
    if (this.initialized) return;

    try {
      const disableAll = process.env.MCP_DISABLE === 'true';
      if (disableAll) {
        this.initialized = true;
        return;
      }

      const braveDisabled = process.env.MCP_BRAVE_DISABLE === 'true';
      const braveKey = process.env.BRAVE_API_KEY;
      if (!braveDisabled && braveKey) {
        const npxPath = findNpxPath();
        const endpoint = `${npxPath} -y @modelcontextprotocol/server-brave-search`;
        const config: MCPServerConfig = {
          serverId: 'brave',
          transport: 'stdio',
          endpoint,
          env: {
            BRAVE_API_KEY: braveKey,
          },
        };
        this.configs.set('brave', config);
      }
    } catch (err) {
      console.error('❌ MCP initFromEnv failed:', err);
    } finally {
      this.initialized = true;
    }
  }

  static startAll(): void {
    if (this.started) return;
    this.initFromEnv();

    for (const [serverId, cfg] of this.configs.entries()) {
      try {
        const component = new MCPClientComponent({
          id: `${serverId}_mcp_component`,
          sessionConfig: {
            transport: cfg.transport,
            endpoint: cfg.endpoint,
            authConfig: {
              type: 'stdio',
              config: {
                env: cfg.env || {},
              },
            },
          },
        });
        this.components.set(serverId, component);
        console.log(`✅ MCP component started: ${serverId}`);
      } catch (error) {
        console.error(`❌ Failed to start MCP component: ${serverId}`, error);
      }
    }

    this.started = true;
  }

  static isEnabled(serverId: MCPServerId): boolean {
    this.initFromEnv();
    return this.configs.has(serverId);
  }

  static getComponent(serverId: MCPServerId): MCPClientComponent | null {
    this.startAll();
    return this.components.get(serverId) || null;
  }

  static createNodes(
    serverId: MCPServerId,
    opts?: {
      listId?: string;
      callId?: string;
      reportListToClient?: boolean;
      reportCallToClient?: boolean;
    }
  ): { list: MCPListToolsNode; call: MCPCallToolNode } | null {
    const component = this.getComponent(serverId);
    if (!component) return null;

    const list = new MCPListToolsNode({
      id: opts?.listId || `${serverId}_mcp_list_tools_node`,
      mcpComponent: component,
      reportToClient: opts?.reportListToClient ?? false,
    });

    const call = new MCPCallToolNode({
      id: opts?.callId || `${serverId}_mcp_call_tool_node`,
      mcpComponent: component,
      reportToClient: opts?.reportCallToClient ?? true,
    });

    return { list, call };
  }

  static async shutdown(): Promise<void> {
    // If SDK exposes teardown, call it here. For now, rely on process exit.
    this.components.clear();
    this.configs.clear();
    this.started = false;
    this.initialized = false;
  }
}


