---
title: Screenshots
namespace: screenshots
commands:
  - install
  - build
  - serve
  - watch

default_json_code: >-
  {
  	jekyll: {
  		src: "docs",
  		dest: "dist/docs"
  	},
  	tasks: [],
  	serve: {
  		port: 4000,
  		open: true
  	}
  }
config:
  - key: "jekyll.src"
    description_markdown: "Sets the input folder for jekyll"
  - key: "jekyll.dest"
    description_markdown: "Sets the output folder for docs build"
  - key: "tasks"
    description_markdown: "Adds additional tasks to be run before the jekyll build. This is useful for reducing build time in jekyll."
  - key: "serve.port"
    description_markdown: "Specifies the port to serve the built site from."
  - key: "serve.open"
    description_markdown: "Should the docs:serve task automatically open a tab in a browser"
dev_path: packages/reports
order: 4
---