import { assertEquals } from "@std/assert";
import { ProcessManager } from "./main.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

// Mock server for testing HTTP health checks
async function startMockServer(port: number, shouldFail = false) {
  const ac = new AbortController();
  const serverPromise = serve(
    (_req) => {
      return new Response(null, {
        status: shouldFail ? 500 : 200,
      });
    },
    {
      port,
      signal: ac.signal,
      onListen: undefined, // Don't log
    }
  );

  // Wait a bit for the server to start
  await delay(100);

  return {
    cleanup: async () => {
      ac.abort();
      try {
        await serverPromise;
      } catch (error) {
        if (
          !(error instanceof TypeError && error.message.includes("aborted"))
        ) {
          throw error;
        }
      }
    },
  };
}

Deno.test({
  name: "ProcessManager - HTTP health check success",
  async fn() {
    const port = 8081;
    const { cleanup } = await startMockServer(port);

    try {
      const manager = new ProcessManager({
        command: ["echo", "test"],
        healthCheckUrl: `http://localhost:${port}/health`,
        healthCheckInterval: 100,
        maxRetries: 1,
      });

      await delay(100); // Give the server time to be ready
      const healthCheck = await manager.checkHealth();
      assertEquals(healthCheck, true);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "ProcessManager - HTTP health check failure",
  async fn() {
    const port = 8082;
    const { cleanup } = await startMockServer(port, true);

    try {
      const manager = new ProcessManager({
        command: ["echo", "test"],
        healthCheckUrl: `http://localhost:${port}/health`,
        healthCheckInterval: 100,
        maxRetries: 1,
      });

      await delay(100); // Give the server time to be ready
      const healthCheck = await manager.checkHealth();
      assertEquals(healthCheck, false);
    } finally {
      await cleanup();
    }
  },
});

Deno.test({
  name: "ProcessManager - Command health check success",
  async fn() {
    const manager = new ProcessManager({
      command: ["echo", "test"],
      healthCheckCommand: ["true"],
      healthCheckInterval: 100,
      maxRetries: 1,
    });

    const healthCheck = await manager.checkHealth();
    assertEquals(healthCheck, true);
  },
});

Deno.test({
  name: "ProcessManager - Command health check failure",
  async fn() {
    const manager = new ProcessManager({
      command: ["echo", "test"],
      healthCheckCommand: ["false"],
      healthCheckInterval: 100,
      maxRetries: 1,
    });

    const healthCheck = await manager.checkHealth();
    assertEquals(healthCheck, false);
  },
});

Deno.test({
  name: "ProcessManager - Process monitoring",
  async fn() {
    const manager = new ProcessManager({
      command: ["sleep", "2"],
      healthCheckInterval: 100,
      maxRetries: 1,
    });

    // Start the process in background
    const startPromise = manager.start();

    // Give the process time to start
    await delay(300);

    // First check - process should be running
    const healthCheck1 = await manager.checkHealth();
    assertEquals(healthCheck1, true, "Process should be running initially");

    // Stop monitoring and wait for process to complete
    await manager.stop();

    // Give process time to fully terminate
    await delay(100);

    // Final check - process should be done
    const healthCheck2 = await manager.checkHealth();
    assertEquals(healthCheck2, false, "Process should be finished");

    try {
      await startPromise;
    } catch (error: any) {
      // Ignore expected errors
      if (
        !error?.message?.includes("Monitoring stopped") &&
        !error?.message?.includes("process terminated")
      ) {
        throw error;
      }
    }
  },
});
