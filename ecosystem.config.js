module.exports = {
  apps: [{
    name: 'cortex',
    script: 'npm',
    args: 'start',
    env: {
      PORT: 8001
    }
  }]
}