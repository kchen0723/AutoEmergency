import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Image,
  ActivityIndicator, Modal, Pressable,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { WebView } from 'react-native-webview';

// ─── Change this to your real API endpoint ────────────────────────────────────
const REPORT_API_URL = 'https://your-server.example.com/api/report';
// ─────────────────────────────────────────────────────────────────────────────

async function sendReport(photoUri, coords) {
  if (REPORT_API_URL.includes('your-server.example.com')) {
    await new Promise((r) => setTimeout(r, 1500)); // mock
    return;
  }
  const formData = new FormData();
  formData.append('latitude', String(coords.latitude));
  formData.append('longitude', String(coords.longitude));
  formData.append('accuracy', String(coords.accuracy));
  formData.append('timestamp', new Date().toISOString());
  formData.append('photo', { uri: photoUri, name: 'photo.jpg', type: 'image/jpeg' });
  const res = await fetch(REPORT_API_URL, {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
}

// Build a local HTML page that embeds Google Maps in an iframe (required by the API)
function buildMapHtml(lat, lng) {
  const src = `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
  return `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>*{margin:0;padding:0}html,body,iframe{width:100%;height:100%;border:none}</style>
  </head><body>
    <iframe src="${src}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>
  </body></html>`;
}

export default function App() {
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);

  // 'camera' | 'map' | 'photo'  – what the main viewport shows
  const [viewMode, setViewMode] = useState('camera');

  // 'ready' | 'capturing' | 'locating' | 'sending' | 'success' | 'error'
  const [status, setStatus] = useState('ready');
  const [statusMsg, setStatusMsg] = useState('📷 准备拍照...');

  const cameraRef = useRef(null);
  const isProcessing = useRef(false);
  const prefetchedLocRef = useRef(null);

  // Burst-mode tracking
  const [isAutoBurst, setIsAutoBurst] = useState(false);
  const captureTimestamps = useRef([]);
  const burstIntervalRef = useRef(null);

  // Pre-fetch location in parallel with camera warmup
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync();
        if (last) prefetchedLocRef.current = last.coords;
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        prefetchedLocRef.current = fresh.coords;
        setLocation(fresh.coords);
      } catch (e) {
        console.warn('Background location prefetch failed:', e);
      }
    })();
    requestCamPermission();
    return () => { if (burstIntervalRef.current) clearInterval(burstIntervalRef.current); };
  }, []);

  const handleShutter = useCallback(async () => {
    if (isProcessing.current || !cameraRef.current) return;
    isProcessing.current = true;

    // Switch back to camera for capture
    setViewMode('camera');

    try {
      setStatus('capturing');
      setStatusMsg('📸 正在拍照...');
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      setPhoto(picture.uri);

      setStatus('locating');
      setStatusMsg('📍 正在获取位置...');
      let coords = prefetchedLocRef.current;
      if (coords) {
        setLocation(coords);
      } else {
        const locPerm = await Location.requestForegroundPermissionsAsync();
        if (locPerm.status !== 'granted') {
          setStatus('error');
          setStatusMsg('❌ 位置权限被拒绝');
          isProcessing.current = false;
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coords = loc.coords;
        setLocation(coords);
      }

      setStatus('sending');
      setStatusMsg('📡 正在发送...');
      await sendReport(picture.uri, coords);

      setStatus('success');
      const successMsg = isAutoBurst ? '✅ 已发送（自动模式）' : '✅ 已成功发送！';
      setStatusMsg(successMsg);

      // Burst-mode detection
      if (!isAutoBurst) {
        const now = Date.now();
        captureTimestamps.current = [
          ...captureTimestamps.current.filter(t => now - t < 7000),
          now,
        ];
        if (captureTimestamps.current.length >= 3) {
          startAutoBurst(handleShutter);
        }
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
      setStatusMsg(`❌ 失败：${err.message}`);
    } finally {
      isProcessing.current = false;
    }
  }, [isAutoBurst]);

  const startAutoBurst = useCallback((shutterFn) => {
    setIsAutoBurst(true);
    setStatusMsg('🔴 自动连拍模式（每3秒）');
    burstIntervalRef.current = setInterval(() => { shutterFn(); }, 3000);
  }, []);

  const stopAutoBurst = useCallback(() => {
    if (burstIntervalRef.current) {
      clearInterval(burstIntervalRef.current);
      burstIntervalRef.current = null;
    }
    setIsAutoBurst(false);
    setStatus('ready');
    setStatusMsg('📷 准备拍照...');
    captureTimestamps.current = [];
  }, []);

  const didAutoShutter = useRef(false);
  const onCameraReady = useCallback(() => {
    if (!didAutoShutter.current) {
      didAutoShutter.current = true;
      setTimeout(() => handleShutter(), 1500);
    }
  }, [handleShutter]);

  const statusColor = {
    ready: '#5856D6', capturing: '#5856D6', locating: '#007AFF',
    sending: '#FF9500', success: '#34C759', error: '#FF3B30',
  }[status] ?? '#8E8E93';

  const activeBannerColor = isAutoBurst ? '#FF3B30' : statusColor;
  const isWorking = ['capturing', 'locating', 'sending'].includes(status);

  if (!camPermission) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (!camPermission.granted) return (
    <View style={styles.center}>
      <Text style={styles.permText}>需要相机权限</Text>
      <TouchableOpacity style={styles.permBtn} onPress={requestCamPermission}>
        <Text style={styles.permBtnText}>授予权限</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🚨 Auto Emergency Reporter</Text>

      {/* Status banner */}
      <View style={[styles.statusBanner, { borderColor: activeBannerColor }]}>
        {(isWorking || isAutoBurst) && (
          <ActivityIndicator size="small" color={activeBannerColor} style={{ marginRight: 8 }} />
        )}
        <Text style={[styles.statusText, { color: activeBannerColor }]}>{statusMsg}</Text>
      </View>

      {/* Stop auto-burst button */}
      {isAutoBurst && (
        <TouchableOpacity style={styles.stopBtn} onPress={stopAutoBurst}>
          <Text style={styles.stopBtnText}>⏹ 停止自动拍照</Text>
        </TouchableOpacity>
      )}

      {/* ── Main viewport: camera / map / photo ─────────────────────────── */}
      <View style={styles.viewportContainer}>

        {/* Camera — always mounted but hidden when not active */}
        <CameraView
          ref={cameraRef}
          style={[styles.fill, viewMode !== 'camera' && styles.hidden]}
          facing="back"
          onCameraReady={onCameraReady}
        />

        {/* Google Maps */}
        {viewMode === 'map' && location && (
          <WebView
            style={styles.fill}
            source={{ html: buildMapHtml(location.latitude, location.longitude) }}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#007AFF" />
                <Text style={styles.loadingText}>正在加载地图...</Text>
              </View>
            )}
          />
        )}

        {/* Full-size captured photo */}
        {viewMode === 'photo' && photo && (
          <Image source={{ uri: photo }} style={styles.fill} resizeMode="contain" />
        )}

        {/* Back button when not in camera mode */}
        {viewMode !== 'camera' && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setViewMode('camera')}>
            <Text style={styles.backBtnText}>← 返回相机</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* ─────────────────────────────────────────────────────────────────── */}

      {/* Info row: thumbnail + location — both tappable */}
      <View style={styles.infoRow}>

        {/* Thumbnail — tap to see full photo */}
        <TouchableOpacity
          style={styles.thumbnailBtn}
          onPress={() => photo && setViewMode('photo')}
          disabled={!photo}
        >
          {photo
            ? <Image source={{ uri: photo }} style={styles.thumbnail} />
            : <View style={styles.thumbnailPlaceholder}>
                <Text style={styles.placeholderText}>无照片</Text>
              </View>
          }
          {photo && <Text style={styles.thumbnailCaption}>最近照片</Text>}
        </TouchableOpacity>

        {/* Location — tap to see map */}
        <TouchableOpacity
          style={styles.locationBtn}
          onPress={() => location && setViewMode('map')}
          disabled={!location}
        >
          <Text style={styles.locationLabel}>📍 位置</Text>
          {location
            ? <>
                <Text style={styles.locationCoord}>{location.latitude.toFixed(5)}</Text>
                <Text style={styles.locationCoord}>{location.longitude.toFixed(5)}</Text>
                <Text style={styles.locationHint}>点击查看地图</Text>
              </>
            : <Text style={styles.locationCoord}>未获取</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Shutter button */}
      <TouchableOpacity
        style={[styles.shutterBtn, isWorking && styles.shutterBtnDisabled]}
        onPress={handleShutter}
        disabled={isWorking}
      >
        {isWorking
          ? <ActivityIndicator size="small" color="#fff" />
          : <Text style={styles.shutterText}>
              {status === 'success' || status === 'error' ? '🔄 再次拍照发送' : '📷 拍照并发送'}
            </Text>
        }
      </TouchableOpacity>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1C1C1E', padding: 12, paddingBottom: 28, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },
  title: { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 8, marginTop: 28 },
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    padding: 10, borderRadius: 10, borderWidth: 1.5, backgroundColor: '#2C2C2E', marginBottom: 8,
  },
  statusText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  stopBtn: {
    width: '100%', backgroundColor: '#FF3B30', paddingVertical: 10,
    borderRadius: 10, alignItems: 'center', marginBottom: 8,
  },
  stopBtnText: { color: '#FFF', fontSize: 13, fontWeight: '700' },

  // Main viewport
  viewportContainer: { width: '100%', flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', marginBottom: 10 },
  fill: { ...StyleSheet.absoluteFillObject },
  hidden: { opacity: 0 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },
  loadingText: { color: '#FFF', marginTop: 12, fontSize: 13 },
  backBtn: {
    position: 'absolute', top: 12, left: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  backBtnText: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  // Info row
  infoRow: { flexDirection: 'row', width: '100%', marginBottom: 10, gap: 8 },
  thumbnailBtn: { flex: 1, alignItems: 'center', backgroundColor: '#2C2C2E', borderRadius: 10, padding: 8 },
  thumbnail: { width: 64, height: 64, borderRadius: 10 },
  thumbnailPlaceholder: {
    width: 64, height: 64, borderRadius: 10, backgroundColor: '#3A3A3C',
    alignItems: 'center', justifyContent: 'center',
  },
  thumbnailCaption: { color: '#EBEBF5', fontSize: 10, marginTop: 3 },
  placeholderText: { color: '#8E8E93', fontSize: 10 },
  locationBtn: {
    flex: 1, backgroundColor: '#2C2C2E', borderRadius: 10, padding: 10,
    justifyContent: 'center',
  },
  locationLabel: { color: '#EBEBF5', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  locationCoord: { color: '#8E8E93', fontSize: 12 },
  locationHint: { color: '#007AFF', fontSize: 10, marginTop: 3 },

  // Shutter
  shutterBtn: {
    width: '100%', backgroundColor: '#FF3B30', paddingVertical: 16,
    borderRadius: 14, alignItems: 'center', elevation: 4,
  },
  shutterBtnDisabled: { backgroundColor: '#555', elevation: 0 },
  shutterText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  permText: { color: '#FFF', fontSize: 16, marginBottom: 16 },
  permBtn: { backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permBtnText: { color: '#FFF', fontWeight: '600' },
});
