const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class StockfishEngine {
  constructor() {
    this.engine = null;
    this.isReady = false;
    this.pendingCallback = null;
    this.lastEvaluation = null;
    this.outputBuffer = '';
  }

  init() {
    return new Promise((resolve, reject) => {
      try {
        const stockfishPath = path.join(__dirname, '..', 'engine', 'stockfish.exe');
        
        if (!fs.existsSync(stockfishPath)) {
          console.error(`Stockfish not found at: ${stockfishPath}`);
          reject(new Error('Stockfish executable not found'));
          return;
        }
        
        console.log(`Starting Stockfish from: ${stockfishPath}`);
        
        this.engine = spawn(stockfishPath, [], {
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.engine.stdout.on('data', (data) => {
          this.outputBuffer += data.toString();
          this.processOutput();
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
        }, 10000);

        const checkInterval = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkInterval);
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

  processOutput() {
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.includes('uciok')) {
        this.isReady = true;
        this.sendCommand('setoption name Threads value 2');
        this.sendCommand('setoption name Hash value 128');
        this.sendCommand('isready');
      }
      
      if (line.startsWith('bestmove')) {
        const parts = line.split(' ');
        const bestMove = parts[1];
        if (this.pendingCallback) {
          this.pendingCallback(bestMove);
          this.pendingCallback = null;
        }
      }
      
      if (line.includes('info') && line.includes('score cp')) {
        const match = line.match(/score cp\s+([-\d]+)/);
        if (match) {
          this.lastEvaluation = {
            type: 'cp',
            value: parseInt(match[1]),
            pawnAdvantage: parseInt(match[1]) / 100
          };
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

  async getFullAnalysis(fen, depth = 18) {
    if (!this.isReady) {
      await this.waitForReady();
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Analysis timeout'));
      }, 30000);
      
      let bestMove = null;
      let evaluation = null;
      
      const originalCallback = this.pendingCallback;
      
      this.pendingCallback = (move) => {
        bestMove = move;
        if (bestMove && evaluation) {
          clearTimeout(timeout);
          resolve({
            fen: fen,
            bestMove: bestMove,
            evaluation: evaluation,
            variation: [],
            depth: depth,
            timestamp: new Date().toISOString()
          });
        }
        if (originalCallback) originalCallback(move);
      };
      
      this.sendCommand(`position fen ${fen}`);
      this.sendCommand(`go depth ${depth}`);
      
      const checkInterval = setInterval(() => {
        if (this.lastEvaluation && !evaluation) {
          evaluation = this.lastEvaluation;
          if (bestMove && evaluation) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve({
              fen: fen,
              bestMove: bestMove,
              evaluation: evaluation,
              variation: [],
              depth: depth,
              timestamp: new Date().toISOString()
            });
          }
        }
      }, 100);
    });
  }

  async waitForReady() {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.isReady) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
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
