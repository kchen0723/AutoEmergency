import { StatusBar } from 'expo-status-bar';
import { useState, useEffect, useCallback, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';

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

export default function App() {
  const [camPermission, requestCamPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [location, setLocation] = useState(null);

  // 'ready' | 'capturing' | 'locating' | 'sending' | 'success' | 'error'
  const [status, setStatus] = useState('ready');
  const [statusMsg, setStatusMsg] = useState('📷 准备拍照...');

  const cameraRef = useRef(null);
  const isProcessing = useRef(false);
  const prefetchedLocRef = useRef(null);

  // Burst-mode tracking
  const [isAutoBurst, setIsAutoBurst] = useState(false);
  const captureTimestamps = useRef([]);   // timestamps of recent captures
  const burstIntervalRef = useRef(null);  // setInterval handle

  // Start fetching location right away — runs in parallel with camera warmup
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;

        // Try last-known position first (instant)
        const last = await Location.getLastKnownPositionAsync();
        if (last) prefetchedLocRef.current = last.coords;

        // Then get a fresh accurate fix in the background
        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced, // faster than High
        });
        prefetchedLocRef.current = fresh.coords;
        setLocation(fresh.coords);
      } catch (e) {
        console.warn('Background location prefetch failed:', e);
      }
    })();
    requestCamPermission();
    // Cleanup interval on unmount
    return () => { if (burstIntervalRef.current) clearInterval(burstIntervalRef.current); };
  }, []);

  const handleShutter = useCallback(async () => {
    if (isProcessing.current || !cameraRef.current) return;
    isProcessing.current = true;

    try {
      // 1. Capture photo instantly (no OK button — in-app camera)
      setStatus('capturing');
      setStatusMsg('� 正在拍照...');
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      setPhoto(picture.uri);

      // 2. Get location — use prefetched value if available (no wait!)
      setStatus('locating');
      setStatusMsg('📍 正在获取位置...');
      let coords = prefetchedLocRef.current;
      if (coords) {
        // Already have a location from prefetch — use it instantly
        setLocation(coords);
      } else {
        // Fallback: fetch now if prefetch didn't complete yet
        const locPerm = await Location.requestForegroundPermissionsAsync();
        if (locPerm.status !== 'granted') {
          setStatus('error');
          setStatusMsg('❌ 位置权限被拒绝');
          isProcessing.current = false;
          return;
        }
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = loc.coords;
        setLocation(coords);
      }

      // 3. Send
      setStatus('sending');
      setStatusMsg('📡 正在发送...');
      await sendReport(picture.uri, coords);

      setStatus('success');
      const successMsg = isAutoBurst ? '✅ 已发送（自动模式）' : '✅ 已成功发送！';
      setStatusMsg(successMsg);

      // ── Burst-mode detection ──────────────────────────────────────────────
      if (!isAutoBurst) {
        const now = Date.now();
        captureTimestamps.current = [
          ...captureTimestamps.current.filter(t => now - t < 7000),
          now,
        ];
        if (captureTimestamps.current.length >= 3) {
          // 3 captures within 7 seconds → start auto burst
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
  }, []);

  // ── Burst-mode helpers ──────────────────────────────────────────────────────
  const startAutoBurst = useCallback((shutterFn) => {
    setIsAutoBurst(true);
    setStatusMsg('🔴 自动连拍模式（每3秒）');
    burstIntervalRef.current = setInterval(() => {
      shutterFn();
    }, 3000);
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
  // ───────────────────────────────────────────────────────────────────────────

  // Auto-shutter when app launches (as soon as camera is ready)
  const didAutoShutter = useRef(false);
  const onCameraReady = useCallback(() => {
    if (!didAutoShutter.current) {
      didAutoShutter.current = true;
      // Small delay so camera sensor stabilises before capture
      setTimeout(() => handleShutter(), 1500);
    }
  }, [handleShutter]);

  const statusColor = {
    ready: '#5856D6', capturing: '#5856D6', locating: '#007AFF',
    sending: '#FF9500', success: '#34C759', error: '#FF3B30',
  }[status] ?? '#8E8E93';

  const burstColor = '#FF3B30'; // red banner for auto mode
  const activeBannerColor = isAutoBurst ? burstColor : statusColor;
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
        {(isWorking || isAutoBurst) && <ActivityIndicator size="small" color={activeBannerColor} style={{ marginRight: 8 }} />}
        <Text style={[styles.statusText, { color: activeBannerColor }]}>{statusMsg}</Text>
      </View>

      {/* Stop auto-burst button */}
      {isAutoBurst && (
        <TouchableOpacity style={styles.stopBtn} onPress={stopAutoBurst}>
          <Text style={styles.stopBtnText}>⏹ 停止自动拍照</Text>
        </TouchableOpacity>
      )}

      {/* Camera preview — always visible so cameraRef stays valid */}
      <View style={styles.cameraContainer}>
        <CameraView
          ref={cameraRef}
          style={styles.cameraView}
          facing="back"
          onCameraReady={onCameraReady}
        />
      </View>

      {/* Show last captured photo as thumbnail */}
      {photo && (
        <View style={styles.thumbnailContainer}>
          <Text style={styles.thumbnailLabel}>最近照片：</Text>
          <Image source={{ uri: photo }} style={styles.thumbnail} />
        </View>
      )}

      {/* Location display */}
      {location && (
        <View style={styles.infoContainer}>
          <Text style={styles.label}>位置：</Text>
          <Text style={styles.valueText}>
            {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
          </Text>
        </View>
      )}

      {/* Shutter button — manual trigger */}
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
  container: { flex: 1, backgroundColor: '#1C1C1E', padding: 16, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1C1E' },
  title: { fontSize: 14, fontWeight: '700', color: '#FFF', marginBottom: 8, marginTop: 28 },
  statusBanner: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    padding: 12, borderRadius: 12, borderWidth: 1.5, backgroundColor: '#2C2C2E', marginBottom: 12,
  },
  statusText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  cameraContainer: {
    width: '100%', flex: 1, borderRadius: 16,
    overflow: 'hidden', marginBottom: 10, backgroundColor: '#000',
  },
  cameraView: { flex: 1 },
  thumbnailContainer: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#2C2C2E', borderRadius: 12, padding: 8, marginBottom: 12,
  },
  thumbnailLabel: { color: '#EBEBF5', fontSize: 13, marginRight: 8 },
  thumbnail: { width: 64, height: 64, borderRadius: 8 },
  infoContainer: {
    width: '100%', padding: 12, backgroundColor: '#2C2C2E', borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12,
  },
  label: { fontSize: 14, fontWeight: '600', color: '#EBEBF5' },
  valueText: { fontSize: 13, color: '#EBEBF5', textAlign: 'right' },
  shutterBtn: {
    width: '100%', backgroundColor: '#FF3B30', paddingVertical: 18,
    borderRadius: 16, alignItems: 'center', elevation: 4,
  },
  shutterBtnDisabled: { backgroundColor: '#555', elevation: 0 },
  shutterText: { color: '#FFF', fontSize: 17, fontWeight: '700' },
  stopBtn: {
    width: '100%', backgroundColor: '#FF3B30', paddingVertical: 12,
    borderRadius: 12, alignItems: 'center', marginBottom: 8,
  },
  stopBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  permText: { color: '#FFF', fontSize: 16, marginBottom: 16 },
  permBtn: { backgroundColor: '#007AFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permBtnText: { color: '#FFF', fontWeight: '600' },
});

