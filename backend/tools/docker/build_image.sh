#!/bin/bash
docker build -t platform-executor:latest -f Dockerfile.execution .
echo "Execution image built: platform-executor:latest"
