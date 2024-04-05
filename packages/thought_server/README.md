A simple http service that hosts LLM models and provides API that uses them to generate thoughts for Headlong agents.

To run:

```
cd packages though_server

# Make sure you have a `thinkers.yaml` file with your LLM API service providers set up

# set up your Python virtual env

pip install -r requirements.txt

. ./launch.sh
```
