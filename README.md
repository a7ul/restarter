# Restarter

A simple process manager and monitoring tool written in Deno that automatically restarts processes when they fail health checks.

## Features

- HTTP health check endpoint monitoring
- Custom HTTP status code validation
- Custom health check command support
- Configurable retry attempts (including infinite retries)
- Configurable health check intervals
- Process monitoring and automatic restart

## Installation

```bash
deno install --global --allow-run --allow-net -n restarter https://raw.githubusercontent.com/a7ul/restarter/refs/heads/main/main.ts
```

## Usage

```bash
restarter [options] command [args...]
```

### Options

- `--health-check-url`: URL to ping for health check
- `--health-check-command`: Command to run for health check
- `--expected-status-codes`: Comma-separated list of acceptable HTTP status codes (default: 2xx)
- `--check-interval`: Health check interval in milliseconds (default: 5000)
- `--max-retries`: Maximum number of restart attempts (default: -1, infinite)
- `--help`: Show help message

### Examples

Monitor a Node.js server with HTTP health check:

```bash
restarter --health-check-url http://localhost:3000/health node server.js
```

Monitor with specific acceptable HTTP status codes:

```bash
restarter --health-check-url http://localhost:3000/health --expected-status-codes 200,201,204 node server.js
```

Monitor a service with a custom health check command:

```bash
restarter --health-check-command "curl localhost:3000" ./my-server
```

Run with custom check interval and max retries:

```bash
restarter --check-interval 10000 --max-retries 5 --health-check-url http://localhost:3000/health python app.py
```

Monitor process existence only:

```bash
restarter ./my-long-running-process
```

## Health Checks

The tool supports three types of health checks:

1. **HTTP Health Check**: Sends an HTTP request to the specified URL. The process is considered healthy if:
   - The response status matches any of the specified `expected-status-codes`, if provided
   - The response status is in the 2xx range (default behavior when no specific codes are provided)
2. **Command Health Check**: Runs a specified command. The process is considered healthy if the command exits with status 0.
3. **Process Existence**: If no health check is specified, the tool only monitors if the process is still running.

## Development

### Running Tests

```bash
deno test --allow-net
```

The test suite includes:

- HTTP health check testing
- Custom status code validation testing
- Command health check testing
- Process monitoring testing
- Retry mechanism testing

### Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT
