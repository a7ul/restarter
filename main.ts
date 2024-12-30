#!/usr/bin/env deno run --allow-run --allow-net

import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

interface Config {
  command: string[];
  healthCheckCommand?: string[];
  healthCheckUrl?: string;
  healthCheckInterval: number;
  maxRetries: number;
  expectedStatusCodes?: number[];
}

export class ProcessManager {
  private process: Deno.ChildProcess | null = null;
  private retryCount = 0;
  private config: Config;
  private abortController: AbortController;

  constructor(config: Config) {
    this.config = config;
    this.abortController = new AbortController();
  }

  async start(): Promise<void> {
    try {
      await this.startProcess();
      // Start health check monitoring
      await this.monitor();
    } catch (error) {
      console.error("Failed to start process:", error);
      Deno.exit(1);
    }
  }

  private async startProcess(): Promise<void> {
    const command = new Deno.Command(this.config.command[0], {
      args: this.config.command.slice(1),
      stdout: "inherit",
      stderr: "inherit",
    });
    this.process = command.spawn();

    // Wait a bit to ensure process has started
    await delay(100);
  }

  async checkHealth(): Promise<boolean> {
    if (this.config.healthCheckUrl) {
      let response: Response | null = null;
      try {
        response = await fetch(this.config.healthCheckUrl);
        if (this.config.expectedStatusCodes) {
          return this.config.expectedStatusCodes.includes(response.status);
        }
        return response.ok;
      } catch {
        return false;
      } finally {
        response?.body?.cancel();
      }
    }

    if (this.config.healthCheckCommand) {
      try {
        const command = new Deno.Command(this.config.healthCheckCommand[0], {
          args: this.config.healthCheckCommand.slice(1),
          stdout: "null",
          stderr: "null",
        });
        const { success } = await command.output();
        return success;
      } catch {
        return false;
      }
    }

    // If no health check is configured, check if process is still running
    if (!this.process) {
      return false;
    }

    try {
      const status = await Promise.race([
        this.process.status,
        Promise.resolve(undefined),
      ]);
      // Process is healthy if it hasn't exited yet (status is undefined)
      return status === undefined;
    } catch {
      // If we can't get status, assume process is not healthy
      return false;
    }
  }

  async stop(): Promise<void> {
    await this.abortController.abort();
    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Process might already be dead
      }
    }
  }

  private async monitor(): Promise<void> {
    while (true) {
      try {
        // Check if monitoring should stop
        if (this.abortController.signal.aborted) {
          return;
        }

        // Use Promise.race to make the delay abortable
        await Promise.race([
          delay(this.config.healthCheckInterval),
          new Promise((_, reject) => {
            this.abortController.signal.addEventListener("abort", () =>
              reject(new Error("Monitoring stopped"))
            );
          }),
        ]);

        const isHealthy = await this.checkHealth();

        if (!isHealthy) {
          console.error("Health check failed");

          // Only exit if maxRetries is not -1 and we've exceeded it
          if (
            this.config.maxRetries !== -1 &&
            this.retryCount >= this.config.maxRetries
          ) {
            console.error("Max retries reached. Exiting...");
            await this.stop();
            throw new Error("Max retries reached");
          }

          this.retryCount++;
          console.log(
            `Attempting restart (${this.retryCount}/${
              this.config.maxRetries === -1 ? "∞" : this.config.maxRetries
            })`
          );

          // Kill existing process if it's still running
          if (this.process) {
            try {
              this.process.kill();
            } catch {
              // Process might already be dead
            }
          }

          // Start a new process
          await this.startProcess();
        } else {
          // Reset retry count on successful health check
          this.retryCount = 0;
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Monitoring stopped") {
          return;
        }
        console.error("Monitor loop error:", error);
        throw error; // Propagate errors in test environment
      }
    }
  }
}

function showHelp() {
  console.log(`
Usage: restarter [options] <command> [args...]

Options:
  --health-check-command   Command to run for health check
  --health-check-url      URL to ping for health check
  --expected-status-codes Comma-separated list of acceptable HTTP status codes (default: 2xx)
  --check-interval        Health check interval in milliseconds (default: 5000)
  --max-retries          Maximum number of restart attempts (default: unlimited)
  --help                 Show this help message

Example:
  restarter --health-check-url http://localhost:3000/health node server.js
  restarter --health-check-command "curl localhost:3000" ./my-server
  restarter --health-check-url http://localhost:3000/health --expected-status-codes 200,201,204 node server.js
`);
}

async function main() {
  // Find where the options end (first argument without --)
  const commandStartIndex = Deno.args.findIndex(
    (arg) =>
      !arg.startsWith("--") &&
      !Deno.args[Deno.args.indexOf(arg) - 1]?.startsWith("--")
  );
  if (commandStartIndex === -1) {
    console.error("Error: No command specified.");
    showHelp();
    Deno.exit(1);
  }

  // Split args into options and command
  const options = [];
  for (let i = 0; i < commandStartIndex; i++) {
    if (Deno.args[i].startsWith("--")) {
      options.push(Deno.args[i]);
      // If next arg doesn't start with --, it's the value for this option
      if (i + 1 < commandStartIndex && !Deno.args[i + 1].startsWith("--")) {
        options.push(Deno.args[i + 1]);
        i++; // Skip the value in next iteration
      }
    }
  }
  const command = Deno.args.slice(commandStartIndex);

  // Parse only the options part
  const args = parseArgs(options, {
    string: [
      "health-check-command",
      "health-check-url",
      "expected-status-codes",
      "check-interval",
      "max-retries",
    ],
    boolean: ["help"],
    default: {
      "check-interval": 5000,
      "max-retries": "-1",
    },
  });

  if (args.help) {
    showHelp();
    Deno.exit(0);
  }

  const config: Config = {
    command: command,
    healthCheckInterval: Number(args["check-interval"]),
    maxRetries: Number(args["max-retries"]) || -1,
    expectedStatusCodes: args["expected-status-codes"]?.split(",").map(Number),
  };

  if (args["health-check-command"]) {
    config.healthCheckCommand = args["health-check-command"].split(" ");
  }

  if (args["health-check-url"]) {
    config.healthCheckUrl = args["health-check-url"];
  }

  if (!config.healthCheckCommand && !config.healthCheckUrl) {
    console.log(
      "No health check specified, will only monitor process existence"
    );
  }

  const manager = new ProcessManager(config);
  await manager.start();
}

if (import.meta.main) {
  main();
}
