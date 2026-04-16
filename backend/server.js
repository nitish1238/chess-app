const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const passport = require('passport');
const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/games');
const GameManager = require('./chess/gameManager');
const StockfishEngine = require('./ai/stockfish');
const authMiddleware = require('./middleware/auth');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(passport.initialize());
require('./config/passport')(passport);

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
      io.to(gameId).emit('move-made', {
        fen: game.fen(),
        move: { from, to, promotion },
        turn: game.turn(),
        isCheckmate: game.in_checkmate(),
        isStalemate: game.in_stalemate(),
        history: game.history()
      });

      // Save move to database
      const Game = require('./models/Game');
      await Game.findOneAndUpdate(
        { gameId: gameId },
        { 
          fen: game.fen(),
          moves: game.history(),
          lastMoveAt: new Date(),
          status: game.in_checkmate() || game.in_stalemate() ? 'completed' : 'active'
        }
      );

      // Request AI suggestion after opponent's move
      const gameState = gameManager.getGameState(gameId);
      const currentPlayerId = gameState.turn() === 'w' ? 
        gameManager.getWhitePlayerId(gameId) : gameManager.getBlackPlayerId(gameId);
      
      if (currentPlayerId === socket.userId) {
        stockfishEngine.getBestMove(gameState.fen(), (bestMove) => {
          socket.emit('ai-suggestion', { bestMove });
          
          // Save AI suggestion to database for paid users
          const User = require('./models/User');
          User.findById(socket.userId).then(user => {
            if (user && user.subscriptionStatus === 'active') {
              // Premium feature: log AI suggestions
              console.log(`AI suggestion for user ${socket.userId}: ${bestMove}`);
            }
          });
        });
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
      gameManager.removePlayer(socket.id);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});