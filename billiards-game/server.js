// server.js - MVP server for web billiards
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// Config
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'adminkey123';

// Ensure folders
if(!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
if(!fs.existsSync('./public')) fs.mkdirSync('./public');

// multer for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

// Simple file JSON DB
const DB_FILE = './db.json';
function loadDB(){
  if(!fs.existsSync(DB_FILE)){
    const base = { users: [], deposits: [], withdraws: [], ledger: [], rooms: {} };
    fs.writeFileSync(DB_FILE, JSON.stringify(base, null, 2));
    return base;
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}
function saveDB(db){ 
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); 
}
let db = loadDB();

// Helper functions
function findUserByEmail(email){ return db.users.find(u=>u.email === email); }
function findUserById(id){ return db.users.find(u=>u.id === id); }
function createUser({username, email, password}){
  const hashed = bcrypt.hashSync(password, 8);
  const u = { 
    id: uuidv4(), 
    username, 
    email, 
    password: hashed, 
    balance: 0.0, 
    createdAt: Date.now(), 
    deviceId: null 
  };
  db.users.push(u); 
  saveDB(db); 
  return u;
}
function setUserPassword(id, newPass){
  const u = findUserById(id); 
  if(!u) return null;
  u.password = bcrypt.hashSync(newPass, 8); 
  saveDB(db); 
  return u;
}
function creditUser(id, amount, note='admin credit'){
  const u = findUserById(id); 
  if(!u) return null;
  u.balance = Number((u.balance + Number(amount)).toFixed(8));
  db.ledger.push({ 
    id: uuidv4(), 
    type:'credit', 
    user:id, 
    amount, 
    note, 
    ts:Date.now() 
  });
  saveDB(db); 
  return u;
}
function debitUser(id, amount, note='debit'){
  const u = findUserById(id); 
  if(!u) return null;
  u.balance = Number((u.balance - Number(amount)).toFixed(8));
  db.ledger.push({ 
    id: uuidv4(), 
    type:'debit', 
    user:id, 
    amount, 
    note, 
    ts:Date.now() 
  });
  saveDB(db); 
  return u;
}

// Auth APIs
app.post('/api/register', (req,res)=>{
  const { username, email, password, deviceId } = req.body;
  if(!email || !password || !username) {
    return res.status(400).json({ok:false, msg:'missing fields'});
  }
  if(findUserByEmail(email)) {
    return res.status(400).json({ok:false, msg:'email already used'});
  }
  const user = createUser({username, email, password});
  if(deviceId) {
    user.deviceId = deviceId;
    saveDB(db);
  }
  return res.json({
    ok:true, 
    user:{
      id:user.id, 
      username:user.username, 
      email:user.email, 
      balance:user.balance
    }
  });
});

app.post('/api/login', (req,res)=>{
  const { email, password, deviceId } = req.body;
  const user = findUserByEmail(email);
  if(!user) return res.status(400).json({ok:false, msg:'invalid credentials'});
  
  const ok = bcrypt.compareSync(password, user.password);
  if(!ok) return res.status(400).json({ok:false, msg:'invalid credentials'});
  
  if(deviceId) { 
    user.deviceId = deviceId; 
    saveDB(db); 
  }
  return res.json({
    ok:true, 
    user:{
      id:user.id, 
      username:user.username, 
      email:user.email, 
      balance:user.balance
    }
  });
});

// Auto-login by deviceId
app.post('/api/autologin', (req,res)=>{
  const { deviceId } = req.body;
  if(!deviceId) return res.json({ok:false});
  const u = db.users.find(x=>x.deviceId === deviceId);
  if(!u) return res.json({ok:false});
  return res.json({
    ok:true, 
    user:{
      id:u.id, 
      username:u.username, 
      email:u.email, 
      balance:u.balance
    }
  });
});

// Profile
app.get('/api/profile/:id', (req,res)=>{
  const u = findUserById(req.params.id);
  if(!u) return res.status(404).json({ok:false});
  return res.json({
    ok:true, 
    user:{
      id:u.id, 
      username:u.username, 
      email:u.email, 
      balance:u.balance
    }
  });
});

// Deposit upload
app.post('/api/deposit', upload.single('proof'), (req,res)=>{
  const { userId, amount, method, txid } = req.body;
  if(!userId || !amount || !method) {
    return res.status(400).json({ok:false,msg:'missing fields'});
  }
  const rec = { 
    id: uuidv4(), 
    userId, 
    amount:Number(amount), 
    method, 
    txid: txid||null, 
    proof: req.file ? req.file.filename : null, 
    status:'pending', 
    createdAt: Date.now()
  };
  db.deposits.push(rec); 
  saveDB(db);
  return res.json({ok:true, deposit:rec});
});

// Withdraw request
app.post('/api/withdraw', (req,res)=>{
  const { userId, amount, method, payoutInfo } = req.body;
  if(!userId || !amount || !method) {
    return res.status(400).json({ok:false,msg:'missing fields'});
  }
  const u = findUserById(userId);
  if(!u) return res.status(400).json({ok:false,msg:'user not found'});
  if(Number(u.balance) < Number(amount)) {
    return res.status(400).json({ok:false,msg:'insufficient balance'});
  }
  const rec = { 
    id: uuidv4(), 
    userId, 
    amount:Number(amount), 
    method, 
    payoutInfo: payoutInfo||null, 
    status:'pending', 
    createdAt: Date.now()
  };
  db.withdraws.push(rec); 
  saveDB(db);
  return res.json({ok:true, withdraw:rec});
});

// Admin middleware
function checkAdminKey(req){
  const key = req.headers['x-admin-key'] || req.query.key;
  return key && key === ADMIN_KEY;
}

// Admin - list deposits
app.get('/api/admin/deposits', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  return res.json({
    ok:true, 
    deposits: db.deposits.filter(d=>d.status==='pending')
  });
});

// Admin - approve deposit
app.post('/api/admin/deposit/approve', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { depositId, creditAmount } = req.body;
  const dep = db.deposits.find(d=>d.id === depositId);
  if(!dep) return res.status(404).json({ok:false});
  
  dep.status = 'approved';
  dep.adminTs = Date.now();
  creditUser(dep.userId, Number(creditAmount || dep.amount), 'deposit approved');
  saveDB(db);
  return res.json({ok:true});
});

app.post('/api/admin/deposit/reject', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { depositId, reason } = req.body;
  const dep = db.deposits.find(d=>d.id === depositId);
  if(!dep) return res.status(404).json({ok:false});
  
  dep.status = 'rejected';
  dep.adminTs = Date.now();
  dep.adminReason = reason || '';
  saveDB(db);
  return res.json({ok:true});
});

// Admin - users management
app.get('/api/admin/users', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  return res.json({ok:true, users: db.users});
});

app.post('/api/admin/user/credit', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { userId, amount } = req.body;
  creditUser(userId, Number(amount), 'admin credit');
  return res.json({ok:true});
});

app.post('/api/admin/user/genpass', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { userId } = req.body;
  const newPass = Math.random().toString(36).slice(-8);
  setUserPassword(userId, newPass);
  return res.json({ok:true, newPass});
});

// Admin - withdrawals
app.get('/api/admin/withdraws', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  return res.json({
    ok:true, 
    withdraws: db.withdraws.filter(w=>w.status==='pending')
  });
});

app.post('/api/admin/withdraw/approve', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { withdrawId } = req.body;
  const w = db.withdraws.find(x=>x.id===withdrawId);
  if(!w) return res.status(404).json({ok:false});
  
  const u = findUserById(w.userId);
  if(!u) return res.status(404).json({ok:false});
  
  if(u.balance < w.amount) {
    w.status='failed';
    saveDB(db);
    return res.json({ok:false,msg:'insufficient balance'});
  }
  
  debitUser(u.id, w.amount, 'withdraw approved');
  w.status='approved';
  w.adminTs=Date.now();
  saveDB(db);
  return res.json({ok:true});
});

app.post('/api/admin/withdraw/reject', (req,res)=>{
  if(!checkAdminKey(req)) return res.status(403).json({ok:false});
  const { withdrawId, reason } = req.body;
  const w = db.withdraws.find(x=>x.id===withdrawId);
  if(!w) return res.status(404).json({ok:false});
  
  w.status='rejected';
  w.adminTs=Date.now();
  w.adminReason=reason;
  saveDB(db);
  return res.json({ok:true});
});

// Serve uploads
app.get('/uploads/:fname', (req,res)=> {
  const f = path.join(__dirname,'uploads', req.params.fname);
  if(fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('not found');
});

// Socket.io - Matchmaking and game flow
let waiting = [];
const activeGames = {};

io.on('connection', socket=>{
  console.log('User connected:', socket.id);
  
  socket.on('registerSocketUser', (data)=>{ 
    socket.userId = data.userId;
  });
  
  socket.on('joinQueue', (data) => {
    const stake = Number(data.stake) || 0;
    const uid = data.userId;
    const user = findUserById(uid);
    
    if(!user){ 
      socket.emit('joinError','user not found'); 
      return; 
    }
    if(user.balance < stake){ 
      socket.emit('joinError','insufficient balance'); 
      return; 
    }
    
    // Hold the stake amount
    user.balance = Number((user.balance - stake).toFixed(8));
    db.ledger.push({ 
      id: uuidv4(), 
      type:'hold', 
      user: uid, 
      amount: stake, 
      ts:Date.now() 
    });
    saveDB(db);
    
    waiting.push({socketId:socket.id, stake, userId:uid});
    socket.emit('queued', {stake});
    
    // Try to match players
    matchPlayers();
  });
  
  function matchPlayers(){
    for(let i=0; i<waiting.length; i++){
      for(let j=i+1; j<waiting.length; j++){
        if(waiting[i].stake === waiting[j].stake){
          const p1 = waiting.splice(j,1)[0];
          const p2 = waiting.splice(i,1)[0];
          
          const roomId = 'room-'+uuidv4().slice(0,8);
          const u1 = findUserById(p1.userId);
          const u2 = findUserById(p2.userId);
          
          db.rooms[roomId] = { 
            players:[
              {id: p1.userId, username: u1.username},
              {id: p2.userId, username: u2.username}
            ], 
            stake:p1.stake, 
            ts: Date.now() 
          };
          saveDB(db);
          
          activeGames[roomId] = {
            player1: p1.socketId,
            player2: p2.socketId
          };
          
          io.to(p1.socketId).socketsJoin(roomId);
          io.to(p2.socketId).socketsJoin(roomId);
          
          io.to(p1.socketId).emit('matchFound', {
            roomId, 
            players: db.rooms[roomId].players, 
            stake: p1.stake,
            yourTurn: true,
            playerIndex: 0
          });
          
          io.to(p2.socketId).emit('matchFound', {
            roomId, 
            players: db.rooms[roomId].players, 
            stake: p2.stake,
            yourTurn: false,
            playerIndex: 1
          });
          
          return;
        }
      }
    }
  }
  
  socket.on('joinBot', data=>{
    const stake = Number(data.stake)||0;
    const uid = data.userId;
    const user = findUserById(uid);
    
    if(!user){ 
      socket.emit('joinError','user not found'); 
      return; 
    }
    if(user.balance < stake){ 
      socket.emit('joinError','insufficient balance'); 
      return; 
    }
    
    user.balance = Number((user.balance - stake).toFixed(8));
    db.ledger.push({ 
      id: uuidv4(), 
      type:'hold', 
      user: uid, 
      amount: stake, 
      ts:Date.now() 
    });
    
    const roomId = 'room-'+uuidv4().slice(0,8);
    db.rooms[roomId] = { 
      players:[
        {id: uid, username: user.username},
        {id: 'BOT', username: 'BOT'}
      ], 
      stake, 
      ts:Date.now(), 
      bot:true 
    };
    saveDB(db);
    
    socket.join(roomId);
    socket.emit('matchFound', {
      roomId, 
      players: db.rooms[roomId].players, 
      stake,
      yourTurn: true,
      playerIndex: 0
    });
  });
  
  // Game events
  socket.on('gameShot', (data) => {
    socket.to(data.roomId).emit('opponentShot', {
      power: data.power,
      angle: data.angle
    });
  });
  
  socket.on('ballUpdate', (data) => {
    socket.to(data.roomId).emit('ballSync', data);
  });
  
  socket.on('gameEnd', (data)=>{
    const room = db.rooms[data.roomId];
    if(!room) return;
    
    const stake = room.stake || 0;
    const winner = data.winnerUserId;
    
    // Winner gets double stake
    const total = stake * 2;
    creditUser(winner, total, 'game win');
    
    db.ledger.push({ 
      id: uuidv4(), 
      type:'payout', 
      user: winner, 
      amount: total, 
      room:data.roomId, 
      ts:Date.now() 
    });
    
    delete db.rooms[data.roomId];
    delete activeGames[data.roomId];
    saveDB(db);
    
    io.to(data.roomId).emit('gameSettlement', {
      roomId:data.roomId, 
      winner
    });
  });
  
  socket.on('disconnect', ()=>{
    console.log('User disconnected:', socket.id);
    
    // Refund waiting players
    waiting = waiting.filter(w=>{
      if(w.socketId === socket.id){
        const u = findUserById(w.userId);
        if(u){ 
          u.balance = Number((u.balance + w.stake).toFixed(8));
          db.ledger.push({ 
            id: uuidv4(), 
            type:'refund', 
            user:w.userId, 
            amount:w.stake, 
            ts:Date.now() 
          });
          saveDB(db);
        }
        return false;
      }
      return true;
    });
  });
});

server.listen(PORT, ()=> {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📁 Database: ${DB_FILE}`);
  console.log(`🔑 Admin key: ${ADMIN_KEY}`);
});
