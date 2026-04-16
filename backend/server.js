const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const GameManager = require('./chess/gameManager');
const StockfishEngine = require('./ai/stockfish');
const { authMiddleware } = require('./middleware/auth');
const connectDB = require('./config/database');

dotenv.config();
const validateEnv = require('./config/validateEnv');
validateEnv();

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/games', authMiddleware, gameRoutes);

// Initialize game manager and AI
const gameManager = new GameManager();
const stockfishEngine = new StockfishEngine();
stockfishEngine.init();

// Store user socket mappings
const userSockets = new Map(); // userId -> socketId
const socketUsers = new Map(); // socketId -> userId

// Socket.IO with authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}, UserId: ${socket.userId}`);
  
  // Store socket mapping
  userSockets.set(socket.userId, socket.id);
  socketUsers.set(socket.id, socket.userId);

  // Create new game
  socket.on('create-game', async () => {
    const gameId = gameManager.createGame(socket.userId);
    socket.join(gameId);
    socket.emit('game-created', { gameId, fen: gameManager.getGameState(gameId).fen() });
    
    // Save to database
    const Game = require('./models/Game');
    const game = new Game({
      gameId: gameId,
      whitePlayer: socket.userId,
      status: 'waiting',
      fen: gameManager.getGameState(gameId).fen()
    });
    await game.save();
  });

  // Join existing game
  socket.on('join-game', async ({ gameId }) => {
    const success = gameManager.joinGame(gameId, socket.userId);
    if (success) {
      socket.join(gameId);
      const game = gameManager.getGameState(gameId);
      io.to(gameId).emit('game-start', {
        fen: game.fen(),
        turn: game.turn(),
        whitePlayer: gameManager.getWhitePlayerId(gameId),
        blackPlayer: socket.userId
      });
      
      // Update database
      const Game = require('./models/Game');
      await Game.findOneAndUpdate(
        { gameId: gameId },
        { 
          blackPlayer: socket.userId,
          status: 'active',
          startedAt: new Date()
        }
      );
    } else {
      socket.emit('error', { message: 'Game full or does not exist' });
    }
  });

  // Make a move
  socket.on('make-move', async ({ gameId, from, to, promotion = 'q' }) => {
    const result = gameManager.makeMove(gameId, socket.userId, from, to, promotion);
    
    if (result.success) {
      const game = gameManager.getGameState(gameId);
      const isGameOver = game.in_checkmate() || game.in_stalemate();
      const winner = game.in_checkmate() 
        ? (game.turn() === 'w' ? 'black' : 'white')
        : (game.in_stalemate() ? 'draw' : null);
      
      io.to(gameId).emit('move-made', {
        fen: game.fen(),
        move: { from, to, promotion },
        turn: game.turn(),
        isCheckmate: game.in_checkmate(),
        isStalemate: game.in_stalemate(),
        history: game.history()
      });

      // Save move to database with winner
      const Game = require('./models/Game');
      await Game.findOneAndUpdate(
        { gameId: gameId },
        { 
          fen: game.fen(),
          moves: game.history(),
          lastMoveAt: new Date(),
          status: isGameOver ? 'completed' : 'active',
          winner: winner
        }
      );

      // Send AI suggestion to the player whose turn it is now
      const gameState = gameManager.getGameState(gameId);
      const nextPlayerId = gameState.turn() === 'w' 
        ? gameManager.getWhitePlayerId(gameId) 
        : gameManager.getBlackPlayerId(gameId);
      
      const suggestionReceiver = nextPlayerId;
      const receiverSocketId = userSockets.get(suggestionReceiver);
      
      if (receiverSocketId) {
        const User = require('./models/User');
        const user = await User.findById(suggestionReceiver);
        const depth = user && user.subscriptionStatus === 'active' ? 20 : 12;
        
        stockfishEngine.getBestMove(gameState.fen(), (bestMove) => {
          io.to(receiverSocketId).emit('ai-suggestion', { bestMove });
        }, depth);
      }
    } else {
      socket.emit('invalid-move', { message: result.error });
    }
  });

  // Request AI analysis (rate limited for free users)
  socket.on('request-analysis', async ({ gameId }) => {
    const game = gameManager.getGameState(gameId);
    if (game) {
      // Check user subscription for detailed analysis
      const User = require('./models/User');
      const user = await User.findById(socket.userId);
      const depth = user && user.subscriptionStatus === 'active' ? 20 : 12;
      
      stockfishEngine.getBestMove(game.fen(), (bestMove) => {
        socket.emit('analysis-result', {
          bestMove,
          fen: game.fen(),
          evaluation: stockfishEngine.getLastEvaluation(),
          isPremium: user && user.subscriptionStatus === 'active'
        });
      }, depth);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    const userId = socketUsers.get(socket.id);
    if (userId) {
      userSockets.delete(userId);
      socketUsers.delete(socket.id);
      gameManager.removePlayer(userId);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});