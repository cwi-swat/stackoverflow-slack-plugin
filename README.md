# StackOverflow Slack Integration

This is a basic script to keep track of the rascal tag on StackOverflow and push
accurate links to Slack. The RSS offered by SO doesn't contain accurate links complicating participation.

## Installation

- make sure node is installed
- run `npm install request` in the folder of this plugin
- put the push url of slack in the file `push-url.txt`
- let a cron-job run `node update.js` every 15 minutes (watch out with frequency, there are only so many calls you're allowed to make on each day)
