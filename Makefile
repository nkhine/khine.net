SHELL += -eu
CODEBUILD_SRC_DIR_x11_us_website_Source := ./src/templates/
LAMBDA_SRC := ./src/lambda/api
LAMBDA_DIST := ./dist/lambda/api
WORKFLOW_SRC := ./src/lambda/workflow
WORKFLOW_DIST := ./dist/lambda/workflow
LAMBDA_LOCAL_DIST := ./dist/sam-local
LAMBDA_DIRS := $(shell find $(LAMBDA_SRC) -mindepth 1 -maxdepth 1 -type d -exec basename {} \;)
WORKFLOW_DIRS := $(shell find $(WORKFLOW_SRC) -mindepth 1 -maxdepth 1 -type d | grep -v 'create-auth-challenge' | xargs -n 1 basename)

build: clear
	env CGO_ENABLED=0 GOARCH=arm64 GOOS=linux go build -o ./dist/cr/trigger/bootstrap ./src/constructs/trigger-fn
	env CGO_ENABLED=0 GOARCH=arm64 GOOS=linux go build -o ./dist/cr/webhook/bootstrap ./src/constructs/webhook-manager-fn
	for dir in $(LAMBDA_DIRS); do \
		env CGO_ENABLED=0 GOARCH=arm64 GOOS=linux go build -tags lambda.norpc -o $(LAMBDA_DIST)/$$dir/bootstrap $(LAMBDA_SRC)/$$dir; \
		zip -j ./dist/$$dir.zip $(LAMBDA_DIST)/$$dir/bootstrap; \
	done
	for dir in $(WORKFLOW_DIRS); do \
		env CGO_ENABLED=0 GOARCH=arm64 GOOS=linux go build -tags lambda.norpc -o $(WORKFLOW_DIST)/$$dir/bootstrap $(WORKFLOW_SRC)/$$dir; \
		zip -j ./dist/$$dir.zip $(WORKFLOW_DIST)/$$dir/bootstrap; \
	done
	# strip ./dist/cr/*/*
	zip -j ./dist/trigger-fn.zip ./dist/cr/trigger/bootstrap
	zip -j ./dist/webhook-manager-fn.zip ./dist/cr/webhook/bootstrap

build-local: clear
	rsync -avm --exclude="*.go"  $(CODEBUILD_SRC_DIR_x11_us_website_Source) $(LAMBDA_SRC);
	mkdir -p $(LAMBDA_LOCAL_DIST)
	for dir in $(LAMBDA_DIRS); do \
		env CGO_ENABLED=0 GOARCH=amd64 GOOS=linux go build -o $(LAMBDA_LOCAL_DIST)/$$dir/bootstrap $(LAMBDA_SRC)/$$dir; \
	done

generate-template: build-local
	@echo "Generating template.yml..."
	@./template.sh # Or whichever script you create

website:
	# Building using TailwindCSS
	@echo "Building using TailwindCSS..."

	# Start the HTMX code in the background
	@cd ../website && npx tailwindcss -i assets/css/input.css -o assets/css/output.css --minify && python -m http.server 8000 &

sam: generate-template
	# Start sam in the background
	sam local start-api --host 0.0.0.0 -t ./template.yml &

local: stop sam website
	@echo "${GREEN}✓ Starting local Nginx server...${NC}\n"

	# Stop and remove the nginx container if it exists
	-docker stop nginx
	-docker rm nginx

	# Start the nginx container with the configuration
	docker run -d --name nginx -p 80:8080 -v $(PWD)/nginx/nginx.conf:/etc/nginx/nginx.conf:ro nginx:latest

	@echo "${RED}✓ Wait for 5s for Nginx to start...${NC}\n"
	sleep 5s


stop:
	# If a process is using port 3000, stop it
	-@kill `lsof -t -i :3000` 2> /dev/null || true
	# If a process is using port 8000, stop it
	-@kill `lsof -t -i :8000` 2> /dev/null || true
	# Stop and remove the nginx container if it exists
	-docker stop nginx
	-docker rm nginx

	
clear: gendirectory
	rm -rf ./dist/*


gendirectory:
	mkdir -p dist
	mkdir -p $(LAMBDA_LOCAL_DIST)

dia:
	cd docs && npx cdk-dia --tree ../cdk.out/tree.json  \
		--include X11CiCdStack \
		--include X11CiCdStack/CentralisedStack/CentralisedStack \
		--include X11CiCdStack/Dev/CommonStack \
		--include X11CiCdStack/Dev/SesStack \
		--include X11CiCdStack/Dev/PasswordlessStack \
		--include X11CiCdStack/Dev/DistributionStack \
		--include X11CiCdStack/Dev/DistributionPipelineStack
