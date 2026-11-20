package com.workman.chat;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Workman Chat - classic Bluetooth (RFCOMM) phone-to-phone link.
 *
 * Every phone listens for incoming connections AND can connect out to a phone it is
 * paired with in Android settings. Messages are length-prefixed UTF-8 frames
 * (4-byte big-endian length + bytes); the JavaScript side decides what is inside.
 */
@CapacitorPlugin(
    name = "WorkmanBT",
    permissions = {
        @Permission(alias = "bt31", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class WorkmanBTPlugin extends Plugin {

    private static final UUID SERVICE_UUID = UUID.fromString("8f3c2b1e-6a7d-4c52-9b0e-5f1d2a3c4b5e");
    private static final int MAX_FRAME = 4 * 1024 * 1024;

    private static class Conn {
        BluetoothSocket sock;
        DataInputStream in;
        DataOutputStream out;
        String name;
    }

    private final Map<String, List<Conn>> conns = new ConcurrentHashMap<>();
    private final Object lock = new Object();
    private final ExecutorService io = Executors.newCachedThreadPool();
    private volatile boolean listening = false;
    private volatile BluetoothServerSocket server = null;

    private BluetoothAdapter adapter() {
        return BluetoothAdapter.getDefaultAdapter();
    }

    private boolean hasPerm() {
        return Build.VERSION.SDK_INT < 31 || getPermissionState("bt31") == PermissionState.GRANTED;
    }

    private void status(String msg) {
        JSObject o = new JSObject();
        o.put("message", msg);
        notifyListeners("status", o);
    }

    /* ------------------------------ permissions ------------------------------ */

    @PluginMethod
    public void requestBt(PluginCall call) {
        if (hasPerm()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("bt31", call, "permCallback");
    }

    @PermissionCallback
    private void permCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", hasPerm());
        call.resolve(r);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        BluetoothAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("supported", a != null);
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        // Try the Bluetooth screen first, then fall back to wider settings screens so the button always opens something.
        String[] screens = {
            Settings.ACTION_BLUETOOTH_SETTINGS,
            Settings.ACTION_WIRELESS_SETTINGS,
            Settings.ACTION_SETTINGS
        };
        for (String action : screens) {
            try {
                Intent i = new Intent(action);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
                return;
            } catch (Exception ignored) {
                // try the next screen
            }
        }
        call.reject("Couldn't open Bluetooth settings");
    }

    /* ------------------------------ paired devices ------------------------------ */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getPaired(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth"); return; }
        if (!hasPerm()) { call.reject("Bluetooth permission not granted"); return; }
        JSArray arr = new JSArray();
        try {
            Set<BluetoothDevice> bonded = a.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSObject o = new JSObject();
                    o.put("name", d.getName() == null ? d.getAddress() : d.getName());
                    o.put("address", d.getAddress());
                    arr.put(o);
                }
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission not granted");
            return;
        }
        JSObject r = new JSObject();
        r.put("devices", arr);
        call.resolve(r);
    }

    /* ------------------------------ listening ------------------------------ */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void startServer(final PluginCall call) {
        final BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth"); return; }
        if (!hasPerm()) { call.reject("Bluetooth permission not granted"); return; }
        if (listening) { call.resolve(); return; }
        listening = true;
        io.execute(new Runnable() {
            @Override
            public void run() {
                while (listening) {
                    BluetoothServerSocket ss = null;
                    try {
                        ss = a.listenUsingRfcommWithServiceRecord("WorkmanChat", SERVICE_UUID);
                        server = ss;
                        status("Listening: other phone can connect to this one");
                        while (listening) {
                            BluetoothSocket s = ss.accept();
                            adopt(s, false);
                        }
                    } catch (IOException e) {
                        if (!listening) break;
                        status("Waiting for Bluetooth… (" + e.getMessage() + ")");
                        sleep(2000);
                    } catch (SecurityException e) {
                        status("Bluetooth permission missing");
                        listening = false;
                    } finally {
                        if (ss != null) {
                            try { ss.close(); } catch (IOException ignored) { }
                        }
                        server = null;
                    }
                }
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void stopServer(PluginCall call) {
        listening = false;
        BluetoothServerSocket ss = server;
        if (ss != null) {
            try { ss.close(); } catch (IOException ignored) { }
        }
        call.resolve();
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
    }

    /* ------------------------------ connect / disconnect ------------------------------ */

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connect(final PluginCall call) {
        final String address = call.getString("address");
        final BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth"); return; }
        if (!a.isEnabled()) { call.reject("Bluetooth is turned off"); return; }
        if (!hasPerm()) { call.reject("Bluetooth permission not granted"); return; }
        if (address == null || !BluetoothAdapter.checkBluetoothAddress(address)) { call.reject("Bad address"); return; }
        if (conns.containsKey(address)) { call.resolve(); return; }
        io.execute(new Runnable() {
            @Override
            public void run() {
                BluetoothSocket s = null;
                try {
                    BluetoothDevice d = a.getRemoteDevice(address);
                    a.cancelDiscovery();
                    s = d.createRfcommSocketToServiceRecord(SERVICE_UUID);
                    s.connect();
                    adopt(s, true);
                    call.resolve();
                } catch (IOException e) {
                    if (s != null) {
                        try { s.close(); } catch (IOException ignored) { }
                    }
                    call.reject(e.getMessage() == null ? "Could not connect" : e.getMessage());
                } catch (SecurityException e) {
                    call.reject("Bluetooth permission not granted");
                }
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String address = call.getString("address");
        if (address == null) {
            for (String k : new ArrayList<>(conns.keySet())) closeAll(k);
        } else {
            closeAll(address);
        }
        call.resolve();
    }

    private void closeAll(String address) {
        List<Conn> list = conns.get(address);
        if (list == null) return;
        for (Conn c : new ArrayList<>(list)) {
            try { c.sock.close(); } catch (IOException ignored) { }
        }
    }

    @PluginMethod
    public void getConnections(PluginCall call) {
        JSArray arr = new JSArray();
        for (String k : conns.keySet()) arr.put(k);
        JSObject r = new JSObject();
        r.put("addresses", arr);
        call.resolve(r);
    }

    /* ------------------------------ sending ------------------------------ */

    @PluginMethod
    public void send(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null) { call.reject("Missing address or data"); return; }
        io.execute(new Runnable() {
            @Override
            public void run() {
                List<Conn> list = conns.get(address);
                if (list == null || list.isEmpty()) { call.reject("Not connected"); return; }
                byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
                IOException last = null;
                // newest connection first; fall back to the others if one is broken
                for (int i = list.size() - 1; i >= 0; i--) {
                    Conn c = list.get(i);
                    try {
                        synchronized (c.out) {
                            c.out.writeInt(bytes.length);
                            c.out.write(bytes);
                            c.out.flush();
                        }
                        call.resolve();
                        return;
                    } catch (IOException e) {
                        last = e;
                        try { c.sock.close(); } catch (IOException ignored) { }
                    }
                }
                call.reject(last == null || last.getMessage() == null ? "Send failed" : last.getMessage());
            }
        });
    }

    /* ------------------------------ connection bookkeeping ------------------------------ */

    @SuppressLint("MissingPermission")
    private void adopt(BluetoothSocket s, boolean outgoing) {
        try {
            BluetoothDevice remote = s.getRemoteDevice();
            final String addr = remote.getAddress();
            String nm;
            try { nm = remote.getName(); } catch (SecurityException e) { nm = null; }
            if (nm == null) nm = addr;
            final Conn c = new Conn();
            c.sock = s;
            c.name = nm;
            c.in = new DataInputStream(new BufferedInputStream(s.getInputStream()));
            c.out = new DataOutputStream(new BufferedOutputStream(s.getOutputStream()));
            boolean first;
            synchronized (lock) {
                List<Conn> list = conns.get(addr);
                first = (list == null);
                if (first) {
                    list = new CopyOnWriteArrayList<>();
                    conns.put(addr, list);
                }
                // If both phones connect to each other at the same moment there can be two
                // sockets between them. We keep both: we read from all, and write on the newest.
                list.add(c);
            }
            if (first) {
                JSObject o = new JSObject();
                o.put("address", addr);
                o.put("name", nm);
                o.put("outgoing", outgoing);
                notifyListeners("connected", o);
            }
            io.execute(new Runnable() {
                @Override
                public void run() {
                    readLoop(addr, c);
                }
            });
        } catch (IOException e) {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    private void readLoop(String addr, Conn c) {
        try {
            while (true) {
                int len = c.in.readInt();
                if (len < 0 || len > MAX_FRAME) throw new IOException("Bad frame");
                byte[] buf = new byte[len];
                c.in.readFully(buf);
                JSObject o = new JSObject();
                o.put("address", addr);
                o.put("data", new String(buf, StandardCharsets.UTF_8));
                notifyListeners("data", o);
            }
        } catch (IOException e) {
            // link closed or broken
        } finally {
            drop(addr, c);
        }
    }

    private void drop(String addr, Conn c) {
        try { c.sock.close(); } catch (IOException ignored) { }
        boolean gone = false;
        synchronized (lock) {
            List<Conn> list = conns.get(addr);
            if (list != null) {
                list.remove(c);
                if (list.isEmpty()) {
                    conns.remove(addr);
                    gone = true;
                }
            }
        }
        if (gone) {
            JSObject o = new JSObject();
            o.put("address", addr);
            notifyListeners("disconnected", o);
        }
    }

    @Override
    protected void handleOnDestroy() {
        listening = false;
        BluetoothServerSocket ss = server;
        if (ss != null) {
            try { ss.close(); } catch (IOException ignored) { }
        }
        for (String k : new ArrayList<>(conns.keySet())) closeAll(k);
        io.shutdownNow();
    }
}
