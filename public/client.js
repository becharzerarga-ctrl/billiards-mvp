
// client.js - Full Billiards Game Client
const socket = io();

// User Management
let currentUser = null;
let deviceId = localStorage.getItem('deviceId') || ('device-' + Math.random().toString(36).slice(2, 10));
localStorage.setItem('deviceId', deviceId);

// Game State
let currentRoom = null;
let gameActive = false;
let myTurn = false;
let playerIndex = 0;

// Three.js Variables
let scene, camera, renderer;
let table, cueBall, targetBalls = [];
let cue, aimLine;
let ballVelocities = new Map();
let ballsMoving = false;

// Initialize on page load
window.addEventListener('load', () => {
  tryAutoLogin();
  setupPowerSlider();
});

// ========== AUTH FUNCTIONS ==========
async function tryAutoLogin() {
  try {
    const response = await fetch('/api/autologin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    const data = await response.json();
    if (data.ok) {
      currentUser = data.user;
      onLoginSuccess();
    }
  } catch (err) {
    console.error('Auto-login failed:', err);
  }
}

function showLoginForm() {
  document.getElementById('registerForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
}

function showRegisterForm() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('registerForm').classList.remove('hidden');
}

async function register() {
  const username = document.getElementById('regUsername').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  
  if (!username || !email || !password) {
    alert('الرجاء ملء جميع الحقول');
    return;
  }
  
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, deviceId })
    });
    const data = await response.json();
    
    if (data.ok) {
      currentUser = data.user;
      onLoginSuccess();
    } else {
      alert('خطأ: ' + data.msg);
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال');
  }
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  if (!email || !password) {
    alert('الرجاء ملء جميع الحقول');
    return;
  }
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId })
    });
    const data = await response.json();
    
    if (data.ok) {
      currentUser = data.user;
      onLoginSuccess();
    } else {
      alert('خطأ: بيانات الدخول غير صحيحة');
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال');
  }
}

function onLoginSuccess() {
  document.getElementById('authCard').classList.add('hidden');
  document.getElementById('lobbyCard').classList.remove('hidden');
  document.getElementById('adminCard').classList.remove('hidden');
  
  document.getElementById('userName').textContent = currentUser.username;
  document.getElementById('userEmail').textContent = currentUser.email;
  document.getElementById('userBalance').textContent = currentUser.balance.toFixed(2);
  
  socket.emit('registerSocketUser', { userId: currentUser.id });
  initGame();
}

// ========== DEPOSIT & WITHDRAW ==========
async function submitDeposit() {
  if (!currentUser) return alert('الرجاء تسجيل الدخول أولاً');
  
  const amount = document.getElementById('depAmount').value;
  const method = document.getElementById('depMethod').value;
  const txid = document.getElementById('depTxid').value;
  const proof = document.getElementById('depProof').files[0];
  
  if (!amount || amount <= 0) {
    return alert('الرجاء إدخال مبلغ صحيح');
  }
  
  const formData = new FormData();
  formData.append('userId', currentUser.id);
  formData.append('amount', amount);
  formData.append('method', method);
  formData.append('txid', txid);
  if (proof) formData.append('proof', proof);
  
  try {
    const response = await fetch('/api/deposit', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    
    if (data.ok) {
      alert('✅ تم إرسال طلب الشحن بنجاح! سيتم مراجعته من قبل الإدارة');
      document.getElementById('depAmount').value = '';
      document.getElementById('depTxid').value = '';
      document.getElementById('depProof').value = '';
    } else {
      alert('❌ حدث خطأ في الإرسال');
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال');
  }
}

async function submitWithdraw() {
  if (!currentUser) return alert('الرجاء تسجيل الدخول أولاً');
  
  const amount = parseFloat(document.getElementById('wdAmount').value);
  const method = document.getElementById('wdMethod').value;
  const info = document.getElementById('wdInfo').value.trim();
  
  if (!amount || amount < 1) {
    return alert('الحد الأدنى للسحب هو $1');
  }
  
  if (!info) {
    return alert('الرجاء إدخال معلومات الاستلام');
  }
  
  try {
    const response = await fetch('/api/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.id,
        amount,
        method,
        payoutInfo: info
      })
    });
    const data = await response.json();
    
    if (data.ok) {
      alert('✅ تم إرسال طلب السحب! سيتم معالجته خلال 1-72 ساعة');
      document.getElementById('wdAmount').value = '';
      document.getElementById('wdInfo').value = '';
    } else {
      alert('❌ خطأ: ' + (data.msg || 'حدث خطأ'));
    }
  } catch (err) {
    alert('حدث خطأ في الاتصال');
  }
}

// ========== MATCHMAKING ==========
function findMatch() {
  if (!currentUser) return alert('الرجاء تسجيل الدخول أولاً');
  
  const stake = parseFloat(document.getElementById('stakeAmount').value);
  if (isNaN(stake) || stake < 0.3) {
    return alert('الحد الأدنى للرهان هو $0.30');
  }
  
  if (currentUser.balance < stake) {
    return alert('رصيدك غير كافي');
  }
  
  socket.emit('joinQueue', { userId: currentUser.id, stake });
  showGameStatus('⏳ جاري البحث عن منافس...', 'waiting');
}

function playBot() {
  if (!currentUser) return alert('الرجاء تسجيل الدخول أولاً');
  
  const stake = parseFloat(document.getElementById('stakeAmount').value);
  if (isNaN(stake) || stake < 0.3) {
    return alert('الحد الأدنى للرهان هو $0.30');
  }
  
  if (currentUser.balance < stake) {
    return alert('رصيدك غير كافي');
  }
  
  socket.emit('joinBot', { userId: currentUser.id, stake });
  showGameStatus('🤖 جاري إعداد اللعبة ضد الروبوت...', 'waiting');
}

function showGameStatus(message, type) {
  const status = document.getElementById('gameStatus');
  status.textContent = message;
  status.className = 'status-' + type;
  status.classList.remove('hidden');
}

// ========== SOCKET EVENTS ==========
socket.on('queued', (data) => {
  console.log('في قائمة الانتظار:', data);
});

socket.on('joinError', (msg) => {
  alert('❌ خطأ: ' + msg);
  document.getElementById('gameStatus').classList.add('hidden');
});

socket.on('matchFound', (data) => {
  console.log('تم إيجاد مباراة!', data);
  currentRoom = data.roomId;
  myTurn = data.yourTurn;
  playerIndex = data.playerIndex;
  
  showGameStatus('✅ تم إيجاد مباراة! جاري تحميل اللعبة...', 'playing');
  
  setTimeout(() => {
    document.getElementById('gameArea').classList.remove('hidden');
    document.getElementById('gameStatus').classList.add('hidden');
    startGame(data);
  }, 1500);
});

socket.on('opponentShot', (data) => {
  console.log('الخصم ضرب الكرة', data);
  // Simulate opponent's shot
  const impulse = new THREE.Vector3(
    Math.cos(data.angle) * data.power * 0.5,
    0,
    Math.sin(data.angle) * data.power * 0.5
  );
  ballVelocities.set(cueBall.uuid, impulse);
  ballsMoving = true;
});

socket.on('gameSettlement', async (data) => {
  gameActive = false;
  
  if (data.winner === currentUser.id) {
    alert('🎉 مبروك! لقد فزت بالمباراة!');
  } else {
    alert('😔 للأسف، خسرت المباراة. حظ أفضل المرة القادمة!');
  }
  
  // Refresh balance
  try {
    const response = await fetch('/api/profile/' + currentUser.id);
    const result = await response.json();
    if (result.ok) {
      currentUser = result.user;
      document.getElementById('userBalance').textContent = currentUser.balance.toFixed(2);
    }
  } catch (err) {
    console.error('Error refreshing balance:', err);
  }
  
  document.getElementById('gameArea').classList.add('hidden');
  resetGame();
});

// ========== GAME INITIALIZATION ==========
function initGame() {
  const canvas = document.getElementById('gameCanvas');
  const width = canvas.clientWidth;
  const height = 500;
  
  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);
  
  // Camera
  camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 80, 100);
  camera.lookAt(0, 0, 0);
  
  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  scene.add(directionalLight);
  
  const pointLight = new THREE.PointLight(0xffffff, 0.5);
  pointLight.position.set(0, 50, 0);
  scene.add(pointLight);
  
  // Table
  createTable();
  
  // Start render loop
  animate();
}

function createTable() {
  // Table surface
  const tableGeometry = new THREE.BoxGeometry(200, 2, 100);
  const tableMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x0d5c0d,
    shininess: 30
  });
  table = new THREE.Mesh(tableGeometry, tableMaterial);
  table.position.y = -1;
  table.receiveShadow = true;
  scene.add(table);
  
  // Table borders
  const borderMaterial = new THREE.MeshPhongMaterial({ color: 0x4a2511 });
  const borderHeight = 6;
  const borderWidth = 4;
  
  // Left border
  const leftBorder = new THREE.Mesh(
    new THREE.BoxGeometry(borderWidth, borderHeight, 100),
    borderMaterial
  );
  leftBorder.position.set(-100 - borderWidth/2, borderHeight/2 - 1, 0);
  leftBorder.castShadow = true;
  scene.add(leftBorder);
  
  // Right border
  const rightBorder = leftBorder.clone();
  rightBorder.position.set(100 + borderWidth/2, borderHeight/2 - 1, 0);
  scene.add(rightBorder);
  
  // Top border
  const topBorder = new THREE.Mesh(
    new THREE.BoxGeometry(200 + borderWidth*2, borderHeight, borderWidth),
    borderMaterial
  );
  topBorder.position.set(0, borderHeight/2 - 1, 50 + borderWidth/2);
  topBorder.castShadow = true;
  scene.add(topBorder);
  
  // Bottom border
  const bottomBorder = topBorder.clone();
  bottomBorder.position.set(0, borderHeight/2 - 1, -50 - borderWidth/2);
  scene.add(bottomBorder);
}

function startGame(matchData) {
  gameActive = true;
  
  // Clear previous balls
  if (cueBall) scene.remove(cueBall);
  targetBalls.forEach(ball => scene.remove(ball));
  targetBalls = [];
  ballVelocities.clear();
  
  // Create cue ball (white)
  const ballGeometry = new THREE.SphereGeometry(2.5, 32, 32);
  const cueBallMaterial = new THREE.MeshPhongMaterial({ 
    color: 0xffffff,
    shininess: 100,
    specular: 0x444444
  });
  cueBall = new THREE.Mesh(ballGeometry, cueBallMaterial);
  cueBall.position.set(-60, 2.5, 0);
  cueBall.castShadow = true;
  scene.add(cueBall);
  ballVelocities.set(cueBall.uuid, new THREE.Vector3());
  
  // Create target balls in triangle formation
  const colors = [0xff0000, 0xffff00, 0x0000ff, 0xff00ff, 0x00ff00, 
                  0xffa500, 0x800080, 0x000000, 0xff1493, 0x00ffff,
                  0xff6347, 0x4169e1, 0x32cd32, 0xffd700, 0x8b4513];
  
  const startX = 40;
  const startZ = 0;
  const spacing = 5.5;
  
  let ballIndex = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      if (ballIndex >= colors.length) break;
      
      const ballMaterial = new THREE.MeshPhongMaterial({ 
        color: colors[ballIndex],
        shininess: 100,
        specular: 0x444444
      });
      const ball = new THREE.Mesh(ballGeometry, ballMaterial);
      
      const x = startX + row * spacing;
      const z = startZ + (col - row/2) * spacing;
      ball.position.set(x, 2.5, z);
      ball.castShadow = true;
      
      scene.add(ball);
      targetBalls.push(ball);
      ballVelocities.set(ball.uuid, new THREE.Vector3());
      
      ballIndex++;
    }
  }
  
  // Create cue stick
  if (cue) scene.remove(cue);
  const cueGeometry = new THREE.CylinderGeometry(0.3, 0.5, 40, 16);
  const cueMaterial = new THREE.MeshPhongMaterial({ color: 0x8b4513 });
  cue = new THREE.Mesh(cueGeometry, cueMaterial);
  cue.rotation.z = Math.PI / 2;
  cue.visible = myTurn;
  scene.add(cue);
  
  updateTurnIndicator();
}

function updateTurnIndicator() {
  const indicator = document.getElementById('turnIndicator');
  const shootBtn = document.getElementById('shootBtn');
  
  if (myTurn) {
    indicator.textContent = '🎯 دورك - اضرب الكرة!';
    indicator.style.color = '#4fc3f7';
    shootBtn.disabled = false;
  } else {
    indicator.textContent = '⏳ انتظر دور المنافس';
    indicator.style.color = '#ffa500';
    shootBtn.disabled = true;
  }
}

function setupPowerSlider() {
  const slider = document.getElementById('powerSlider');
  const fill = document.getElementById('powerFill');
  const value = document.getElementById('powerValue');
  
  slider.addEventListener('input', () => {
    const power = slider.value;
    fill.style.width = power + '%';
    value.textContent = power;
  });
}

function shoot() {
  if (!gameActive || !myTurn || ballsMoving) return;
  
  const power = parseInt(document.getElementById('powerSlider').value) / 100;
  const angle = Math.random() * Math.PI * 2; // Random angle for demo
  
  // Apply impulse to cue ball
  const impulse = new THREE.Vector3(
    Math.cos(angle) * power * 50,
    0,
    Math.sin(angle) * power * 50
  );
  
  ballVelocities.set(cueBall.uuid, impulse);
  ballsMoving = true;
  myTurn = false;
  
  // Hide cue
  if (cue) cue.visible = false;
  
  // Notify server and opponent
  socket.emit('gameShot', {
    roomId: currentRoom,
    power: power * 100,
    angle: angle
  });
  
  updateTurnIndicator();
  
  // Simple game end after 10 seconds (demo)
  setTimeout(() => {
    if (gameActive) {
      const winner = Math.random() > 0.5 ? currentUser.id : 'opponent';
      socket.emit('gameEnd', {
        roomId: currentRoom,
        winnerUserId: winner
      });
    }
  }, 10000);
}

function animate() {
  requestAnimationFrame(animate);
  
  if (gameActive && ballsMoving) {
    updatePhysics();
  }
  
  // Update cue position
  if (cue && myTurn && !ballsMoving) {
    cue.position.x = cueBall.position.x - 25;
    cue.position.y = cueBall.position.y;
    cue.position.z = cueBall.position.z;
  }
  
  renderer.render(scene, camera);
}

function updatePhysics() {
  const friction = 0.98;
  const minVelocity = 0.1;
  let anyMoving = false;
  
  const allBalls = [cueBall, ...targetBalls];
  
  // Update positions
  allBalls.forEach(ball => {
    const velocity = ballVelocities.get(ball.uuid);
    if (!velocity) return;
    
    // Apply friction
    velocity.multiplyScalar(friction);
    
    // Stop if too slow
    if (velocity.length() < minVelocity) {
      velocity.set(0, 0, 0);
    } else {
      anyMoving = true;
    }
    
    // Update position
    ball.position.add(velocity.clone().multiplyScalar(0.016));
    
    // Table boundaries
    const maxX = 95;
    const maxZ = 45;
    
    if (ball.position.x > maxX) {
      ball.position.x = maxX;
      velocity.x *= -0.7;
    }
    if (ball.position.x < -maxX) {
      ball.position.x = -maxX;
      velocity.x *= -0.7;
    }
    if (ball.position.z > maxZ) {
      ball.position.z = maxZ;
      velocity.z *= -0.7;
    }
    if (ball.position.z < -maxZ) {
      ball.position.z = -maxZ;
      velocity.z *= -0.7;
    }
  });
  
  // Ball collisions
  for (let i = 0; i < allBalls.length; i++) {
    for (let j = i + 1; j < allBalls.length; j++) {
      checkCollision(allBalls[i], allBalls[j]);
    }
  }
  
  if (!anyMoving) {
    ballsMoving = false;
    if (gameActive) {
      myTurn = true;
      updateTurnIndicator();
      if (cue) cue.visible = true;
    }
  }
}

function checkCollision(ball1, ball2) {
  const distance = ball1.position.distanceTo(ball2.position);
  const minDistance = 5; // 2.5 + 2.5 radius
  
  if (distance < minDistance) {
    const v1 = ballVelocities.get(ball1.uuid);
    const v2 = ballVelocities.get(ball2.uuid);
    
    const normal = new THREE.Vector3()
      .subVectors(ball2.position, ball1.position)
      .normalize();
    
    const relativeVelocity = new THREE.Vector3().subVectors(v1, v2);
    const speed = relativeVelocity.dot(normal);
    
    if (speed < 0) return;
    
    const impulse = normal.multiplyScalar(speed * 0.9);
    
    v1.sub(impulse);
    v2.add(impulse);
    
    // Separate balls
    const overlap = minDistance - distance;
    const separation = normal.multiplyScalar(overlap / 2);
    ball1.position.sub(separation);
    ball2.position.add(separation);
  }
}

function resetGame() {
  currentRoom = null;
  gameActive = false;
  myTurn = false;
}

// ========== ADMIN FUNCTIONS ==========
function adminLogin() {
  const key = document.getElementById('adminKey').value;
  if (!key) return alert('الرجاء إدخال مفتاح المشرف');
  document.getElementById('adminPanel').classList.remove('hidden');
}

async function viewDeposits() {
  const key = document.getElementById('adminKey').value;
  try {
    const response = await fetch('/api/admin/deposits?key=' + encodeURIComponent(key));
    const data = await response.json();
    
    if (!data.ok) return alert('مفتاح خاطئ');
    
    const content = document.getElementById('adminContent');
    content.innerHTML = '<h4>📥 طلبات الشحن المعلقة</h4>';
    
    if (data.deposits.length === 0) {
      content.innerHTML += '<p>لا توجد طلبات معلقة</p>';
      return;
    }
    
    data.deposits.forEach(dep => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      item.innerHTML = `
        <p><strong>المستخدم:</strong> ${dep.userId}</p>
        <p><strong>المبلغ:</strong> $${dep.amount}</p>
        <p><strong>الطريقة:</strong> ${dep.method}</p>
        <p><strong>TX ID:</strong> ${dep.txid || 'N/A'}</p>
        ${dep.proof ? `<img src="/uploads/${dep.proof}" alt="إثبات">` : ''}
        <div>
          <button class="success" onclick="approveDeposit('${dep.id}', ${dep.amount})">✅ قبول</button>
          <button class="danger" onclick="rejectDeposit('${dep.id}')">❌ رفض</button>
        </div>
      `;
      content.appendChild(item);
    });
  } catch (err) {
    alert('حدث خطأ');
  }
}

async function approveDeposit(id, amount) {
  const key = document.getElementById('adminKey').value;
  const customAmount = prompt('المبلغ المراد إضافته:', amount);
  if (customAmount === null) return;
  
  try {
    const response = await fetch('/api/admin/deposit/approve?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositId: id, creditAmount: parseFloat(customAmount) })
    });
    const data = await response.json();
    if (data.ok) {
      alert('✅ تم اعتماد السحب بنجاح');
      viewWithdraws();
    } else {
      alert('خطأ: ' + (data.msg || 'حدث خطأ'));
    }
  } catch (err) {
    alert('خطأ');
  }
}

async function rejectWithdraw(id) {
  const key = document.getElementById('adminKey').value;
  const reason = prompt('سبب الرفض:');
  if (reason === null) return;
  
  try {
    const response = await fetch('/api/admin/withdraw/reject?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withdrawId: id, reason })
    });
    const data = await response.json();
    if (data.ok) {
      alert('✅ تم رفض الطلب');
      viewWithdraws();
    }
  } catch (err) {
    alert('خطأ');
  }
}

async function viewUsers() {
  const key = document.getElementById('adminKey').value;
  try {
    const response = await fetch('/api/admin/users?key=' + encodeURIComponent(key));
    const data = await response.json();
    
    if (!data.ok) return alert('مفتاح خاطئ');
    
    const content = document.getElementById('adminContent');
    content.innerHTML = '<h4>👥 قائمة المستخدمين</h4>';
    
    data.users.forEach(user => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      item.innerHTML = `
        <p><strong>الاسم:</strong> ${user.username}</p>
        <p><strong>البريد:</strong> ${user.email}</p>
        <p><strong>الرصيد:</strong> ${user.balance.toFixed(2)}</p>
        <p><strong>ID:</strong> ${user.id}</p>
        <div>
          <button onclick="adminGenPassword('${user.id}')">🔑 توليد كلمة سر</button>
          <button onclick="adminCreditUser('${user.id}')">💰 إضافة رصيد</button>
        </div>
      `;
      content.appendChild(item);
    });
  } catch (err) {
    alert('حدث خطأ');
  }
}

async function adminGenPassword(userId) {
  const key = document.getElementById('adminKey').value;
  if (!confirm('هل تريد توليد كلمة سر جديدة لهذا المستخدم؟')) return;
  
  try {
    const response = await fetch('/api/admin/user/genpass?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    const data = await response.json();
    if (data.ok) {
      alert('✅ كلمة السر الجديدة: ' + data.newPass + '\n\nاحفظها وأرسلها للمستخدم');
    }
  } catch (err) {
    alert('خطأ');
  }
}

async function adminCreditUser(userId) {
  const key = document.getElementById('adminKey').value;
  const amount = prompt('المبلغ المراد إضافته:');
  if (!amount || isNaN(amount)) return;
  
  try {
    const response = await fetch('/api/admin/user/credit?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount: parseFloat(amount) })
    });
    const data = await response.json();
    if (data.ok) {
      alert('✅ تم إضافة الرصيد بنجاح');
      viewUsers();
    }
  } catch (err) {
    alert('خطأ');
  }
}
