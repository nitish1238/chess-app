const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  whitePlayer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  blackPlayer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  winner: {
    type: String,
    enum: ['white', 'black', 'draw', null],
    default: null
  },
  status: {
    type: String,
    enum: ['waiting', 'active', 'completed', 'abandoned'],
    default: 'waiting'
  },
  fen: {
    type: String,
    default: 'start'
  },
  moves: [{
    type: String
  }],
  pgn: {
    type: String,
    default: ''
  },
  aiAnalysis: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  startedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  lastMoveAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for faster queries
GameSchema.index({ whitePlayer: 1, createdAt: -1 });
GameSchema.index({ blackPlayer: 1, createdAt: -1 });
GameSchema.index({ status: 1 });

module.exports = mongoose.model('Game', GameSchema);