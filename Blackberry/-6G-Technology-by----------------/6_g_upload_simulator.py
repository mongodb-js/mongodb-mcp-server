# 6G Upload Simulator (Fixed & Testable)
# ----------------------------------------
# Author: ChatGPT (GPT-5)
# Description:
# This file is an asyncio-based upload simulator (server + client) intended for
# demo/benchmarking. This revision fixes a SystemExit:2 caused by argparse when
# the required `--mode` argument was not provided. It also adds a small internal
# test mode so you can verify basic behavior without running network operations.

import argparse
import asyncio
import os
import sys
import time
import csv
from aiohttp import web, ClientSession
from datetime import datetime

# -----------------
# Server Component
# -----------------
class UploadServer:
    def __init__(self, host='0.0.0.0', port=8080, out_file='server_results.csv'):
        self.host = host
        self.port = port
        self.out_file = out_file
        self.stats = []
        self.app = web.Application()
        self.app.router.add_post('/upload', self.handle_upload)

    async def handle_upload(self, request):
        reader = request.content
        total_bytes = 0
        start_time = time.perf_counter()

        async for chunk in reader.iter_chunked(64 * 1024):
            total_bytes += len(chunk)

        end_time = time.perf_counter()
        duration = end_time - start_time
        throughput = total_bytes * 8 / (duration * 1e6) if duration > 0 else 0

        result = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'bytes_received': total_bytes,
            'duration_s': round(duration, 4),
            'throughput_Mbps': round(throughput, 4)
        }

        self.stats.append(result)
        await self.save_results()
        return web.Response(text=f"Upload recorded: {result}")

    async def save_results(self):
        header = ['timestamp', 'bytes_received', 'duration_s', 'throughput_Mbps']
        tmp_file = self.out_file + '.tmp'

        with open(tmp_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=header)
            writer.writeheader()
            writer.writerows(self.stats)
        os.replace(tmp_file, self.out_file)

    def run(self):
        print(f"[SERVER] Running on http://{self.host}:{self.port}")
        web.run_app(self.app, host=self.host, port=self.port)

# -----------------
# Client Component
# -----------------
class UploadClient:
    def __init__(self, url, clients=4, duration=10, chunk_size=256 * 1024, out_file='client_results.csv'):
        self.url = url
        self.clients = clients
        self.duration = duration
        self.chunk_size = chunk_size
        self.out_file = out_file
        self.results = []

    async def upload_worker(self, client_id):
        # This worker posts repeated small payloads until the duration elapses.
        block = b'0' * self.chunk_size
        end_time = time.perf_counter() + self.duration
        bytes_sent = 0

        async with ClientSession() as session:
            while time.perf_counter() < end_time:
                try:
                    # Post one block per request to keep it simple and robust for demo.
                    async with session.post(self.url, data=block) as resp:
                        await resp.text()
                    bytes_sent += len(block)
                except Exception as e:
                    print(f"[CLIENT-{client_id}] Error: {e}")
                    break

        throughput = bytes_sent * 8 / (max(self.duration, 1) * 1e6)
        result = {
            'client_id': client_id,
            'bytes_sent': bytes_sent,
            'throughput_Mbps': round(throughput, 4)
        }
        self.results.append(result)

    async def run(self):
        print(f"[CLIENT] Uploading to {self.url} with {self.clients} clients for {self.duration}s...")
        tasks = [asyncio.create_task(self.upload_worker(i)) for i in range(self.clients)]
        await asyncio.gather(*tasks)
        self.save_results()
        print(f"[CLIENT] Upload complete. Results saved to {self.out_file}")

    def save_results(self):
        header = ['client_id', 'bytes_sent', 'throughput_Mbps']
        tmp_file = self.out_file + '.tmp'

        with open(tmp_file, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=header)
            writer.writeheader()
            writer.writerows(self.results)
        os.replace(tmp_file, self.out_file)

# -----------------
# Argument parser + Test harness
# -----------------

def build_parser():
    p = argparse.ArgumentParser(description="6G Upload Simulator (Server + Client)")
    # Make --mode optional to avoid argparse exiting with status 2 when omitted.
    p.add_argument('--mode', choices=['server', 'client'], help='Run mode: server or client')
    p.add_argument('--host', default='0.0.0.0', help='Server host (server mode)')
    p.add_argument('--port', type=int, default=8080, help='Server port (server mode)')
    p.add_argument('--url', default='http://localhost:8080/upload', help='Upload URL (client mode)')
    p.add_argument('--clients', type=int, default=4, help='Number of parallel upload clients')
    p.add_argument('--duration', type=int, default=10, help='Duration of upload test (seconds)')
    p.add_argument('--chunk-size', type=int, default=256 * 1024, help='Bytes per chunk')
    p.add_argument('--out', default='results.csv', help='Output CSV filename')
    p.add_argument('--run-tests', action='store_true', help='Run internal lightweight tests and exit')
    return p


def run_unit_tests():
    """Lightweight checks that do not require network access.
    These tests validate parser behavior and basic object creation.
    """
    print("Running internal tests...")

    # Test 1: parser default behavior when no --mode provided
    parser = build_parser()
    args = parser.parse_args([])
    assert args.mode is None, "Expected mode to be None when not provided"

    # Test 2: instantiate server and client with non-network parameters
    s = UploadServer(host='127.0.0.1', port=9000, out_file='test_server.csv')
    assert isinstance(s, UploadServer)
    c = UploadClient(url='http://127.0.0.1:9000/upload', clients=1, duration=1, chunk_size=8, out_file='test_client.csv')
    assert isinstance(c, UploadClient)

    # Test 3: ensure save_results creates CSV file structures (without running I/O heavy ops)
    s.stats.append({'timestamp': datetime.utcnow().isoformat() + 'Z', 'bytes_received': 10, 'duration_s': 0.1, 'throughput_Mbps': 0.8})
    asyncio.run(s.save_results())
    assert os.path.exists('test_server.csv'), 'test_server.csv should exist after save_results'
    os.remove('test_server.csv')

    c.results.append({'client_id': 0, 'bytes_sent': 16, 'throughput_Mbps': 0.128})
    c.save_results()
    assert os.path.exists('test_client.csv'), 'test_client.csv should exist after save_results'
    os.remove('test_client.csv')

    print('All internal tests passed.')


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]

    parser = build_parser()
    # If user runs without args, show help (friendly) rather than abort with error.
    if len(argv) == 0:
        parser.print_help()
        print('\nNote: this script requires --mode server or --mode client to run; use --run-tests to execute internal tests.')
        return 0

    args = parser.parse_args(argv)

    if args.run_tests:
        run_unit_tests()
        return 0

    if args.mode is None:
        print('Error: --mode is required when not running --run-tests. Use --mode server or --mode client')
        return 2

    if args.mode == 'server':
        server = UploadServer(host=args.host, port=args.port, out_file=args.out)
        server.run()
    else:
        client = UploadClient(url=args.url, clients=args.clients, duration=args.duration, chunk_size=args.chunk_size, out_file=args.out)
        asyncio.run(client.run())


if __name__ == '__main__':
    exit_code = main()
    # Ensure the script exits with the appropriate code when used in CI/tests.
    if isinstance(exit_code, int):
        sys.exit(exit_code)
