package com.workman.chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WorkmanBTPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
