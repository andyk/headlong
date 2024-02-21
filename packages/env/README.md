# Headlong Env
Headlong Env is a daemon that provides actuation and sensory input for a [Headlong agent](https://github.com/andyk/headlong-vite). Operates by listening to the headlong [JSOS Var](https://github.com/andyk/jsos), executing actions, and updating the headlong var with observations.

# Install & Run Locally via Docker
```
# git clone headlong-env
cd headlong-env
npm install

# make sure docker is running
./run_in_docker # opens an interactive bash shell inside a new docker container named "headlong-env"

# Inside the container, run the bash server
npm run bashServer  # A service that provides an API for a multi-tab terminal emulator - default port is 3031

#In a new local shell tab, connect to the running docker container again to run the main env process:
./connect_to_docker.sh
npm run env  # An env that subscribes to a JSOS Variable and calls functions in response to "action: ..." thoughts.
```

# Install & Run in Ubuntu
```
# Make sure new enough node installed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &&\
sudo apt-get install -y nodejs

# git clone headlong-env
cd headlong-env
npm install

# Inside the container, run the bash server
npm run bashServer  # A service that provides an API for a multi-tab terminal emulator - default port is 3031

#In a new local shell tab, connect to the running docker container again to run the main env process:
./connect_to_docker.sh
npm run env  # An env that subscribes to a JSOS Variable and calls functions in response to "action: ..." thoughts.
```
