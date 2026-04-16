// REPLACE ENTIRE FILE (lines 1-126)
// Current file is empty (0 bytes) - replace with complete implementation below

const { spawn } = require('child_process');

class StockfishEngine {
  constructor() {
    this.engine = null;
    this.isReady = false;
    this.callbacks = new Map();
    this.lastEvaluation = null;
    this.pendingCallback = null;
    this.outputBuffer = '';
  }

  init() {
    return new Promise((resolve, reject) => {
      try {
        this.engine = spawn('stockfish', [], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.engine.stdout.on('data', (data) => {
          this.outputBuffer += data.toString();
          this.handleOutput();
        });

        this.engine.stderr.on('data', (data) => {
          console.error(`Stockfish stderr: ${data}`);
        });

        this.engine.on('error', (error) => {
          console.error('Failed to start Stockfish:', error);
          reject(error);
        });

        this.sendCommand('uci');
        
        const timeout = setTimeout(() => {
          reject(new Error('Stockfish initialization timeout'));
        }, 5000);

        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            clearTimeout(timeout);
            console.log('Stockfish engine ready');
            resolve();
          }
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  sendCommand(command) {
    if (this.engine && this.engine.stdin) {
      this.engine.stdin.write(command + '\n');
    }
  }

  handleOutput() {
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.includes('uciok')) {
        this.isReady = true;
        this.sendCommand('setoption name Threads value 2');
        this.sendCommand('setoption name Hash value 128');
        this.sendCommand('isready');
      }
      
      if (line.includes('readyok')) {
        // Engine ready
      }
      
      if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        if (this.pendingCallback) {
          this.pendingCallback(bestMove);
          this.pendingCallback = null;
        }
      }
      
      if (line.includes('info') && line.includes('score')) {
        const scoreMatch = line.match(/score (cp|mate) ([-\d]+)/);
        if (scoreMatch) {
          const scoreType = scoreMatch[1];
          const scoreValue = parseInt(scoreMatch[2]);
          
          if (scoreType === 'cp') {
            this.lastEvaluation = scoreValue / 100;
          } else if (scoreType === 'mate') {
            this.lastEvaluation = `Mate in ${Math.abs(scoreValue)}`;
          }
        }
      }
    }
  }

  async getBestMove(fen, callback, depth = 15) {
    if (!this.isReady) {
      setTimeout(() => this.getBestMove(fen, callback, depth), 100);
      return;
    }
    
    this.pendingCallback = callback;
    this.sendCommand(`position fen ${fen}`);
    this.sendCommand(`go depth ${depth}`);
  }

  getLastEvaluation() {
    return this.lastEvaluation;
  }

  quit() {
    if (this.engine) {
      this.sendCommand('quit');
      setTimeout(() => {
        this.engine.kill();
      }, 100);
    }
  }
}

module.exports = StockfishEngine;