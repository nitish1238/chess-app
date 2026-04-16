const Chess = require('chess.js').Chess;

class GameManager {
  constructor() {
    this.games = new Map();
    this.playerToGame = new Map(); // userId -> gameId
  }

  createGame(playerId) {
    const gameId = this.generateGameId();
    const game = new Chess();
    
    this.games.set(gameId, {
      game: game,
      whitePlayerId: playerId,
      blackPlayerId: null,
      createdAt: Date.now()
    });
    
    this.playerToGame.set(playerId, gameId);
    return gameId;
  }

  joinGame(gameId, playerId) {
    const gameData = this.games.get(gameId);
    
    if (!gameData) return false;
    if (gameData.blackPlayerId) return false;
    if (gameData.whitePlayerId === playerId) return false;
    
    gameData.blackPlayerId = playerId;
    this.playerToGame.set(playerId, gameId);
    return true;
  }

  makeMove(gameId, playerId, from, to, promotion = 'q') {
    const gameData = this.games.get(gameId);
    if (!gameData) return { success: false, error: 'Game not found' };
    
    const { game, whitePlayerId, blackPlayerId } = gameData;
    
    if (playerId !== whitePlayerId && playerId !== blackPlayerId) {
      return { success: false, error: 'You are not in this game' };
    }
    
    const isWhiteTurn = game.turn() === 'w';
    const isWhitePlayer = playerId === whitePlayerId;
    
    if ((isWhiteTurn && !isWhitePlayer) || (!isWhiteTurn && isWhitePlayer)) {
      return { success: false, error: 'Not your turn' };
    }
    
    try {
      const move = game.move({
        from: from,
        to: to,
        promotion: promotion
      });
      
      if (move) {
        if (game.in_checkmate() || game.in_stalemate()) {
          this.updatePlayerStats(gameData, game);
        }
        return { success: true, move: move };
      } else {
        return { success: false, error: 'Invalid move' };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async updatePlayerStats(gameData, game) {
    const User = require('../models/User');
    
    const whitePlayer = await User.findById(gameData.whitePlayerId);
    const blackPlayer = await User.findById(gameData.blackPlayerId);
    
    if (whitePlayer && blackPlayer) {
      whitePlayer.stats.gamesPlayed += 1;
      blackPlayer.stats.gamesPlayed += 1;
      
      if (game.in_checkmate()) {
        const winner = game.turn() === 'w' ? 'black' : 'white';
        if (winner === 'white') {
          whitePlayer.stats.wins += 1;
          blackPlayer.stats.losses += 1;
        } else {
          whitePlayer.stats.losses += 1;
          blackPlayer.stats.wins += 1;
        }
      } else if (game.in_stalemate()) {
        whitePlayer.stats.draws += 1;
        blackPlayer.stats.draws += 1;
      }
      
      await whitePlayer.save();
      await blackPlayer.save();
    }
  }

  getGameState(gameId) {
    const gameData = this.games.get(gameId);
    return gameData ? gameData.game : null;
  }

  getWhitePlayerId(gameId) {
    const gameData = this.games.get(gameId);
    return gameData ? gameData.whitePlayerId : null;
  }

  getBlackPlayerId(gameId) {
    const gameData = this.games.get(gameId);
    return gameData ? gameData.blackPlayerId : null;
  }

  // FIXED: Now accepts userId, not socket.id
  removePlayer(userId) {  // LINE 83 - changed parameter from socket.id to userId
    const gameId = this.playerToGame.get(userId);  
    if (gameId) { 
      const gameData = this.games.get(gameId);  
      if (gameData && (!gameData.blackPlayerId || gameData.whitePlayerId === userId)) {  
        this.games.delete(gameId);  
      }  
      this.playerToGame.delete(userId);  
    }  
  }  

 generateGameId() {  // LINE 94
    return Math.random().toString(36).substring(2, 8).toUpperCase();  // LINE 95
  }
}

module.exports = GameManager;