import { MCPClientComponent, MCPListToolsNode, MCPCallToolNode } from '@inworld/runtime/graph';
import { execSync } from 'child_process';

export type MCPServerId = string;

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

      // Weather (AccuWeather) server via @timlukahorstmann/mcp-weather
      const weatherDisabled = process.env.MCP_WEATHER_DISABLE === 'true';
      const accuweatherKey = process.env.ACCUWEATHER_API_KEY;
      if (!weatherDisabled && accuweatherKey) {
        const npxPath = findNpxPath();
        const endpoint = `${npxPath} -y @timlukahorstmann/mcp-weather`;
        const config: MCPServerConfig = {
          serverId: 'weather',
          transport: 'stdio',
          endpoint,
          env: {
            ACCUWEATHER_API_KEY: accuweatherKey,
          },
        };
        this.configs.set('weather', config);
      }

      // Exa search server
      const exaDisabled = process.env.MCP_EXA_DISABLE === 'true';
      const exaKey = process.env.EXA_API_KEY;
      if (!exaDisabled && exaKey) {
        const npxPath = findNpxPath();
        const endpoint = `${npxPath} -y exa-mcp-server`;
        const config: MCPServerConfig = {
          serverId: 'exa',
          transport: 'stdio',
          endpoint,
          env: {
            EXA_API_KEY: exaKey,
          },
        };
        this.configs.set('exa', config);
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
        console.log(`[MCP] Starting server '${serverId}' with endpoint: ${cfg.endpoint}`);
        const componentId = `${serverId}_mcp_component_${Date.now()}`; // Add timestamp to ensure uniqueness
        const component = new MCPClientComponent({
          id: componentId,
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
        console.log(`✅ MCP component started: ${serverId} with ID: ${componentId}`);
        console.log(`   Endpoint: ${cfg.endpoint}`);
        console.log(`   Environment:`, cfg.env ? Object.keys(cfg.env) : 'none');
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

  static getEnabledServerIds(): MCPServerId[] {
    this.initFromEnv();
    return Array.from(this.configs.keys());
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

    console.log(`[MCPManager] Creating list node for ${serverId} with component ID: ${component.id}`);
    const list = new MCPListToolsNode({
      id: opts?.listId || `${serverId}_mcp_list_tools_node`,
      mcpComponent: component,
      reportToClient: opts?.reportListToClient ?? false,
    });

    const call = new MCPCallToolNode({
      id: opts?.callId || `${serverId}_mcp_call_tool_node`,
      mcpComponent: component,
      reportToClient: opts?.reportCallToClient ?? true,  // Default to true like in working version
    });

    console.log(`[MCPManager] Created nodes for ${serverId}: list(reportToClient=${opts?.reportListToClient ?? false}), call(reportToClient=${opts?.reportCallToClient ?? false})`);

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


