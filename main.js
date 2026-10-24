import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const TARGET_BLOCKS = 10;
const BLOCK_H = 0.85;
const BASE_SIZE = 2.8;
const GRAVITY = 10.5;
const RANGE = 2.0;

const ASSETS = [
  { file: 'a13e61b33278.glb', label: 'Cabinet Base' },
  { file: '2474ac3cfe1d.glb', label: 'Cube Metal' },
  { file: 'fd7a679961f1.glb', label: 'Houses Age' },
];

let scene, camera, renderer, controls;
let modelInfos = [];
let tower = [];
let towerHeight = 0;
let moving = null;
let falling = [];
let gameState = 'loading'; // loading, menu, playing, gameover, win
let timeAcc = 0;
let isDropping = false;
let bestScore = parseInt(localStorage.getItem('ss_best')||'0');
let bgmAudio, bgmEnabled = true;

const dom = {
  height: document.getElementById('heightVal'),
  score: document.getElementById('scoreVal'),
  best: document.getElementById('bestVal'),
  toast: document.getElementById('toast'),
  center: document.getElementById('centerMsg'),
  panel: document.getElementById('panelContent'),
  playBtn: document.getElementById('playBtn'),
  dropBtn: document.getElementById('dropBtn'),
  muteBtn: document.getElementById('muteBtn'),
  status: document.getElementById('statusTxt'),
  prog: document.getElementById('progressBar'),
  stab: document.getElementById('stabVal'),
};

function showToast(txt, ms=1200){
  dom.toast.textContent = txt;
  dom.toast.classList.add('show');
  setTimeout(()=>dom.toast.classList.remove('show'), ms);
}

function updateUI(){
  const blocks = Math.max(0, tower.length -1);
  dom.height.textContent = towerHeight.toFixed(1)+' m';
  dom.score.textContent = `${blocks} / ${TARGET_BLOCKS}`;
  dom.best.textContent = bestScore;
  const prog = Math.min(100, (blocks / TARGET_BLOCKS)*100);
  dom.prog.style.width = prog + '%';
  let stability = 'Solid';
  if(tower.length>2){
    const last = tower[tower.length-1];
    const prev = tower[tower.length-2];
    const ax = Math.abs(last.posX - prev.posX);
    const az = Math.abs(last.posZ - prev.posZ);
    const off = Math.sqrt(ax*ax+az*az);
    if(off<0.08) stability='Perfect';
    else if(off<0.25) stability='Steady';
    else if(off<0.5) stability='Wobbly';
    else stability='Critical';
  }
  if(gameState==='win') stability='Starlit!';
  if(gameState==='gameover') stability='Collapsed';
  dom.stab.textContent = stability;
  if(gameState==='playing'){
    dom.dropBtn.classList.add('visible');
  } else {
    dom.dropBtn.classList.remove('visible');
  }
}

function computeModelInfo(glbScene){
  const box = new THREE.Box3().setFromObject(glbScene);
  let center = new THREE.Vector3();
  let size = new THREE.Vector3();
  if(box.isEmpty()){
    box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1,1,1));
  }
  box.getCenter(center);
  box.getSize(size);
  // avoid zeros
  if(size.x < 0.01) size.x=1;
  if(size.y < 0.01) size.y=1;
  if(size.z < 0.01) size.z=1;
  return { scene: glbScene, center: center.clone(), size: size.clone() };
}

function createBlockVisual(modelInfo, sx, sy, sz){
  const wrapper = new THREE.Group();
  const pivot = new THREE.Group();
  const clone = modelInfo.scene.clone(true);
  clone.traverse(o=>{
    if(o.isMesh){
      o.castShadow = true;
      o.receiveShadow = true;
      // ensure material tweaks for starlight
      if(o.material){
        // keep original but add slight emissive?
      }
    }
  });
  clone.position.set(-modelInfo.center.x, -modelInfo.center.y, -modelInfo.center.z);
  pivot.add(clone);
  pivot.scale.set(sx / modelInfo.size.x, sy / modelInfo.size.y, sz / modelInfo.size.z);
  wrapper.add(pivot);
  wrapper.userData.pivot = pivot;
  wrapper.userData.baseSize = {x:sx,y:sy,z:sz};
  // optional wire edge for readability when tiny
  if(sx<0.6 || sz<0.6){
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshBasicMaterial({wireframe:true, color:0x8ed8ff, transparent:true, opacity:0.18});
    const wire = new THREE.Mesh(geo, mat);
    wrapper.add(wire);
  }
  return wrapper;
}

async function loadModels(){
  const loader = new GLTFLoader();
  let loaded=0;
  for(let i=0;i<ASSETS.length;i++){
    const asset = ASSETS[i];
    dom.status.textContent = `Loading ${asset.label} (${i+1}/${ASSETS.length})…`;
    try{
      const gltf = await loader.loadAsync('./assets/'+asset.file);
      const info = computeModelInfo(gltf.scene);
      info.label = asset.label;
      modelInfos.push(info);
      loaded++;
      dom.prog.style.width = (loaded/ASSETS.length*100)+'%';
    }catch(e){
      console.error('Failed load', asset.file, e);
      // fallback primitive
      const dummy = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0x8899bb}));
      dummy.add(mesh);
      const info = computeModelInfo(dummy);
      info.label = asset.label + ' (fallback)';
      modelInfos.push(info);
    }
  }
  // sort to have Cabinet first for base
  // already order Cabinet, Cube, House
  dom.status.textContent = `Ready • ${modelInfos.length} relics cached`;
  dom.prog.style.width = '100%';
  setTimeout(()=>{dom.prog.style.width='0%';}, 1200);
}

function initThree(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b18);
  scene.fog = new THREE.Fog(0x070b18, 18, 32);

  camera = new THREE.PerspectiveCamera(52, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(5.5, 6.5, 7.5);

  renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // lights
  const ambient = new THREE.AmbientLight(0x9fb8ff, 0.55);
  scene.add(ambient);
  const moon = new THREE.DirectionalLight(0xcfe2ff, 1.2);
  moon.position.set(4, 10, 3);
  moon.castShadow=true;
  moon.shadow.mapSize.set(1024,1024);
  moon.shadow.camera.near=0.5;
  moon.shadow.camera.far=25;
  moon.shadow.camera.left=-10;
  moon.shadow.camera.right=10;
  moon.shadow.camera.top=10;
  moon.shadow.camera.bottom=-10;
  scene.add(moon);
  const fill = new THREE.PointLight(0x8ed8ff, 1.0, 18);
  fill.position.set(-3, 4, -4);
  scene.add(fill);
  const rim = new THREE.PointLight(0xffb38e, 0.6, 20);
  rim.position.set(5, 2, -5);
  scene.add(rim);

  // starfield
  const starCount=1200;
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(starCount*3);
  for(let i=0;i<starCount;i++){
    const r = 25 + Math.random()*35;
    const theta = Math.random()*Math.PI*2;
    const phi = Math.acos(2*Math.random()-1);
    starPos[i*3]= r*Math.sin(phi)*Math.cos(theta);
    starPos[i*3+1]= (Math.random()*0.8+0.2)*r*Math.cos(phi)+6;
    starPos[i*3+2]= r*Math.sin(phi)*Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos,3));
  const starMat = new THREE.PointsMaterial({color:0xbed8ff, size:0.08, sizeAttenuation:true, transparent:true, opacity:0.9});
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ground
  const groundGeo = new THREE.CircleGeometry(12, 64);
  const groundMat = new THREE.MeshStandardMaterial({color:0x121c35, roughness:0.92, metalness:0.1});
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.position.y=0;
  ground.receiveShadow=true;
  scene.add(ground);
  // glowing ring
  const ringGeo = new THREE.RingGeometry(2.9, 3.2, 64);
  const ringMat = new THREE.MeshBasicMaterial({color:0x8ed8ff, side:THREE.DoubleSide, transparent:true, opacity:0.22});
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI/2;
  ring.position.y=0.02;
  scene.add(ring);
  // grid helper
  const grid = new THREE.GridHelper(20, 20, 0x1a2748, 0x1a2748);
  grid.position.y=0.01;
  scene.add(grid);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=0.08;
  controls.target.set(0,2.5,0);
  controls.minDistance=3;
  controls.maxDistance=18;
  controls.maxPolarAngle=Math.PI/2.05;
  controls.minPolarAngle=0.2;
  controls.enablePan=false;

  window.addEventListener('resize', onResize);
}

function onResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetGame(){
  // clear tower
  tower.forEach(l=>scene.remove(l.mesh));
  tower=[];
  falling.forEach(f=>scene.remove(f.mesh));
  falling=[];
  towerHeight=0;
  timeAcc=0;
  isDropping=false;

  // base block
  const baseInfo = modelInfos[0] || modelInfos[0];
  const baseSizeX = BASE_SIZE;
  const baseSizeZ = BASE_SIZE;
  const baseMesh = createBlockVisual(baseInfo, baseSizeX, BLOCK_H, baseSizeZ);
  baseMesh.position.set(0, BLOCK_H/2, 0);
  scene.add(baseMesh);
  tower.push({mesh:baseMesh, sizeX:baseSizeX, sizeZ:baseSizeZ, posX:0, posZ:0, height:BLOCK_H, centerY:BLOCK_H/2});
  towerHeight = BLOCK_H;

  // spawn first moving
  spawnMovingBlock();
  gameState='playing';
  dom.center.classList.add('hidden');
  updateUI();
  const targetY = towerHeight*0.5;
  controls.target.y = targetY;
}

function spawnMovingBlock(){
  if(tower.length===0) return;
  const prev = tower[tower.length-1];
  const axis = (tower.length % 2 === 1) ? 'x' : 'z'; // alternate
  const sizeX = prev.sizeX;
  const sizeZ = prev.sizeZ;
  const modelIdx = tower.length % modelInfos.length;
  const info = modelInfos[modelIdx];
  const mesh = createBlockVisual(info, sizeX, BLOCK_H, sizeZ);
  const y = towerHeight + BLOCK_H/2;
  mesh.position.set(prev.posX, y, prev.posZ);
  scene.add(mesh);
  moving = {
    mesh,
    sizeX,
    sizeZ,
    axis,
    posValue: 0,
    prevPosX: prev.posX,
    prevPosZ: prev.posZ,
    speed: 0.85 + Math.min(0.9, (tower.length-1)*0.09), // increase speed
    modelInfo: info,
  };
  isDropping=false;
}

function handleDrop(){
  if(gameState!=='playing') return;
  if(!moving || isDropping) return;
  isDropping=true;
  const prev = tower[tower.length-1];
  const axis = moving.axis;
  const delta = moving.posValue; // moving offset from prev
  const absDelta = Math.abs(delta);
  const prevSize = axis==='x' ? prev.sizeX : prev.sizeZ;
  const overlap = prevSize - absDelta;

  if(overlap <= 0.08){
    // miss -> fail
    const fallMesh = moving.mesh;
    moving=null;
    falling.push({mesh:fallMesh, vel:new THREE.Vector3(axis==='x'? Math.sign(delta)*2 : 0, 0, axis==='z'? Math.sign(delta)*2 : 0), rotAxis:new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), rotSpeed:2.5});
    showToast('Miss! Collapsed', 1400);
    triggerGameOver(false);
    return;
  }

  // compute new size
  const newSizeX = axis==='x' ? overlap : prev.sizeX;
  const newSizeZ = axis==='z' ? overlap : prev.sizeZ;
  const sign = Math.sign(delta) || 1;
  const newPosX = axis==='x' ? prev.posX + delta/2 : prev.posX;
  const newPosZ = axis==='z' ? prev.posZ + delta/2 : prev.posZ;

  // place new block (trimmed)
  const info = moving.modelInfo;
  const placedMesh = createBlockVisual(info, newSizeX, BLOCK_H, newSizeZ);
  placedMesh.position.set(newPosX, towerHeight + BLOCK_H/2, newPosZ);
  // small pop animation
  placedMesh.scale.set(1.08,0.9,1.08);
  // remove moving
  scene.remove(moving.mesh);
  scene.add(placedMesh);
  // animate scale back (simple)
  const startScale = {v:1.08};
  const animPop = ()=>{
    placedMesh.scale.lerp(new THREE.Vector3(1,1,1), 0.18);
    if(placedMesh.scale.x>1.001) requestAnimationFrame(animPop);
    else placedMesh.scale.set(1,1,1);
  };
  animPop();

  // overhang piece if cut
  if(overlap < prevSize - 0.001){
    const overSizeX = axis==='x' ? absDelta : prev.sizeX;
    const overSizeZ = axis==='z' ? absDelta : prev.sizeZ;
    const overPosX = axis==='x' ? newPosX + (overlap/2 + overSizeX/2)*sign : newPosX;
    const overPosZ = axis==='z' ? newPosZ + (overlap/2 + overSizeZ/2)*sign : newPosZ;
    const overMesh = createBlockVisual(info, overSizeX, BLOCK_H, overSizeZ);
    overMesh.position.set(overPosX, towerHeight + BLOCK_H/2, overPosZ);
    scene.add(overMesh);
    falling.push({mesh:overMesh, vel:new THREE.Vector3(0,0,0), rotAxis:new THREE.Vector3(Math.random(),Math.random(),Math.random()).normalize(), rotSpeed:1.5 + Math.random()});
    if(absDelta>0.4) showToast('Risky cut!',900);
  }

  // perfect check
  if(absDelta < 0.06){
    showToast('★ PERFECT ★', 700);
    // flash light
    placedMesh.traverse(o=>{
      if(o.isMesh && o.material){
        o.material.emissive = new THREE.Color(0x88ccff);
        setTimeout(()=>{if(o.material) o.material.emissive = new THREE.Color(0x000000);}, 300);
      }
    });
  } else if(absDelta < 0.15){
    showToast('Great!', 600);
  }

  // add to tower
  tower.push({mesh:placedMesh, sizeX:newSizeX, sizeZ:newSizeZ, posX:newPosX, posZ:newPosZ, height:BLOCK_H, centerY:towerHeight + BLOCK_H/2});
  towerHeight += BLOCK_H;
  moving=null;

  const blocks = tower.length-1;
  if(blocks > bestScore){
    bestScore = blocks;
    localStorage.setItem('ss_best', bestScore);
  }

  updateUI();

  if(blocks >= TARGET_BLOCKS){
    triggerWin();
    return;
  }

  spawnMovingBlock();
}

function triggerGameOver(withDelay=true){
  gameState='gameover';
  updateUI();
  if(withDelay===false){
    // small delay to see fall
    setTimeout(showGameOverPanel, 900);
  } else {
    showGameOverPanel();
  }
}

function showGameOverPanel(){
  const blocks = tower.length-1;
  dom.panel.innerHTML = `
    <h1>Collapse</h1>
    <p>The tower shattered at <b>${towerHeight.toFixed(1)} m</b> with <b>${blocks}</b> blocks. The starlight scatters but you can rebuild.</p>
    <p>Stack to <b>${TARGET_BLOCKS}</b> to win. Keep overlaps tight!</p>
    <div class="row"><button class="btn primary" id="retryBtn">↺ Rebuild</button><button class="btn" id="menuBtn">Menu</button></div>
  `;
  dom.center.classList.remove('hidden');
  document.getElementById('retryBtn')?.addEventListener('click',()=>resetGame());
  document.getElementById('menuBtn')?.addEventListener('click',()=>showMenu());
}

function triggerWin(){
  gameState='win';
  updateUI();
  showToast('★ CONSTELLATION REACHED ★', 2000);
  dom.panel.innerHTML = `
    <h1 style="background:linear-gradient(90deg,#ffe08a,#8ed8ff);-webkit-background-clip:text;background-clip:text;color:transparent">You Reached the Stars!</h1>
    <p>You stacked <b>${TARGET_BLOCKS}</b> starlit relics to <b>${towerHeight.toFixed(1)} m</b>. The tower stands stable among constellations.</p>
    <p>Best: ${bestScore} • Height: ${towerHeight.toFixed(1)}m</p>
    <div class="row"><button class="btn primary" id="againBtn">★ Stack Again</button><button class="btn" id="menuBtn2">Menu</button></div>
  `;
  dom.center.classList.remove('hidden');
  document.getElementById('againBtn')?.addEventListener('click',()=>resetGame());
  document.getElementById('menuBtn2')?.addEventListener('click',()=>showMenu());
}

function showMenu(){
  gameState='menu';
  const blocks = Math.max(0,tower.length-1);
  dom.panel.innerHTML = `
    <h1>Starlight Stacker</h1>
    <p>Stack the starlit relics to reach the constellations. Moving piece glides above your tower — drop at right moment. Perfect alignment keeps width, poor cuts shrink the tower. Miss entirely and stars fall.</p>
    <p><span class="kbd">SPACE</span> or <span class="kbd">CLICK</span> to drop • Drag to orbit • Scroll to zoom</p>
    <p style="font-size:12px;color:#7fa0d0">Current: ${blocks} blocks • Best: ${bestScore}<br>Goal: ${TARGET_BLOCKS} blocks. Fail if a block falls away.</p>
    <div class="row"><button class="btn primary" id="playBtn2">▶ Continue Stack</button><button class="btn" id="resetBtn">↺ New Run</button><button class="btn" id="muteBtn2">${bgmEnabled?'♫ Music On':'♪ Muted'}</button></div>
  `;
  dom.center.classList.remove('hidden');
  document.getElementById('playBtn2')?.addEventListener('click',()=>{
    if(tower.length===0) resetGame();
    else {gameState='playing'; dom.center.classList.add('hidden'); updateUI();}
  });
  document.getElementById('resetBtn')?.addEventListener('click',()=>resetGame());
  document.getElementById('muteBtn2')?.addEventListener('click',()=>toggleMute());
  updateUI();
}

function toggleMute(){
  bgmEnabled=!bgmEnabled;
  if(bgmAudio){
    bgmAudio.muted=!bgmEnabled;
    if(bgmEnabled) bgmAudio.play().catch(()=>{});
  }
  dom.muteBtn.textContent = bgmEnabled?'♫ Music On':'♪ Muted';
  const btn2=document.getElementById('muteBtn2');
  if(btn2) btn2.textContent = bgmEnabled?'♫ Music On':'♪ Muted';
}

function setupInput(){
  bgmAudio = document.getElementById('bgm');
  bgmAudio.volume=0.45;
  bgmAudio.muted=!bgmEnabled;

  dom.playBtn.addEventListener('click',()=>{
    if(gameState==='loading') return;
    resetGame();
    if(bgmEnabled) bgmAudio.play().catch(()=>{});
  });
  dom.muteBtn.addEventListener('click',()=>toggleMute());
  dom.dropBtn.addEventListener('click', handleDrop);

  window.addEventListener('keydown', (e)=>{
    if(e.code==='Space'){
      e.preventDefault();
      if(gameState==='menu' || dom.center && !dom.center.classList.contains('hidden')){
        // if in menu, start
        // handled
      }
      handleDrop();
    }
    if(e.code==='KeyR'){
      resetGame();
    }
  });
  window.addEventListener('mousedown', (e)=>{
    if(gameState!=='playing') return;
    // avoid if clicking UI buttons
    const target = e.target;
    if(target.closest && target.closest('button')) return;
    // don't trigger if orbit controls drag
    handleDrop();
  });

  // touch for mobile
  window.addEventListener('touchstart', (e)=>{
    if(gameState!=='playing') return;
    const target = e.target;
    if(target.closest && target.closest('button')) return;
    handleDrop();
  }, {passive:true});
}

function animate(){
  requestAnimationFrame(animate);
  const dt = 1/60;
  // fallback fixed
  timeAcc += dt;

  if(moving && gameState==='playing'){
    moving.posValue = Math.sin(timeAcc * moving.speed) * RANGE;
    if(moving.axis==='x'){
      moving.mesh.position.x = moving.prevPosX + moving.posValue;
    } else {
      moving.mesh.position.z = moving.prevPosZ + moving.posValue;
    }
    // slight bob
    moving.mesh.position.y = towerHeight + BLOCK_H/2 + Math.sin(timeAcc*2.2)*0.03;
    // tilt slightly by movement for feedback
    moving.mesh.rotation.z = moving.axis==='x' ? Math.sin(timeAcc*moving.speed)*0.04 : 0;
    moving.mesh.rotation.x = moving.axis==='z' ? Math.sin(timeAcc*moving.speed)*0.04 : 0;
  }

  // falling physics
  for(let i=falling.length-1;i>=0;i--){
    const f = falling[i];
    f.vel.y -= GRAVITY * dt;
    f.mesh.position.y += f.vel.y * dt;
    f.mesh.position.x += f.vel.x * dt;
    f.mesh.position.z += f.vel.z * dt;
    // rotate
    if(f.rotAxis){
      const q = new THREE.Quaternion().setFromAxisAngle(f.rotAxis, f.rotSpeed*dt);
      f.mesh.quaternion.multiply(q);
    }
    if(f.mesh.position.y < -6){
      scene.remove(f.mesh);
      falling.splice(i,1);
    }
  }

  // camera target lerp to tower mid
  const desired = towerHeight*0.5 + 1;
  controls.target.y += (desired - controls.target.y)*0.05;
  controls.update();

  // ground ring pulse
  // render
  renderer.render(scene,camera);
}

async function main(){
  dom.best.textContent=bestScore;
  initThree();
  setupInput();
  await loadModels();
  gameState='menu';
  dom.status.textContent='Starlight ready — hit Launch';
  updateUI();
  animate();
  showMenu();
  // bind play button that may have been recreated
  dom.playBtn?.addEventListener('click',()=>resetGame());
}

main();
