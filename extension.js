/* extension.js
 * Created by Lucas Gracioso <contact@lbgracioso.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Gst from 'gi://Gst';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

class TimerMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, arrowAlignment, arrowSide, button) {
        super(sourceActor, arrowAlignment, arrowSide);
        this._button = button;

        // ────────────────────────── MENU CONTAINER
        let menuvbox = this._createMenuContainer();
        
        // ────────────────────────── TIMER INPUT (ICON + ENTRY)
        let timerhbox = this._createTimerInput();
        
        menuvbox.add_child(timerhbox);

        // ────────────────────────── BUTTONS AND ICONS
        let buttonshbox = this._createButtons();

        // ────────────────────────── EVENT HANDLERS
        this._connectEventHandlers();
        
        // ────────────────────────── MENU HANDLER
        this._menuItem = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        this._menuItem.add_child(menuvbox);
        this._menuItem.add_child(buttonshbox);
        this.addMenuItem(this._menuItem);
        
        // ────────────────────────── TIMER STATE
        this._timerState = TimerState.Stopped;
        this._remainingTime = 0;
        this._timerInterval = null;
    }

    _createMenuContainer() {
        return new St.BoxLayout({ vertical: true, x_expand: true, y_expand: true });
    }

    _createTimerInput() {
        let timerhbox = new St.BoxLayout({ vertical: false, x_expand: true });

        this._alarmIcon = new St.Icon({
            gicon: Gio.icon_new_for_string('alarm-symbolic'),
            icon_size: 16,
            style_class: 'menu-icon',
        });

        this._timerEntry = new St.Entry({
            hint_text: _('Set Timer ...'),
            can_focus: true,
            x_expand: true,
            style_class: 'menu-entry',
        });

        timerhbox.add_child(this._alarmIcon);
        timerhbox.add_child(this._timerEntry);

        return timerhbox;
    }

    _createButtons() {
        let buttonshbox = new St.BoxLayout({ vertical: false, x_expand: true });

        this._startButton = this._createButton('media-playback-start-symbolic');
        this._pauseButton = this._createButton('media-playback-pause-symbolic');
        this._stopButton = this._createButton('media-playback-stop-symbolic');

        buttonshbox.add_child(this._startButton);
        buttonshbox.add_child(this._pauseButton);
        buttonshbox.add_child(this._stopButton);

        return buttonshbox;
    }

    _createButton(iconName) {
        let button = new St.Button({
            style_class: 'timer-button',
            x_expand: true,
            can_focus: true,
        });

        let icon = new St.Icon({
            gicon: Gio.icon_new_for_string(iconName),
            icon_size: 16,
        });

        button.add_child(icon);

        return button;
    }

    _connectEventHandlers() {
        this._startButton.connect('clicked', () => {
            if (this._timerState === TimerState.Paused) {
                this.resumeTimer();
            } else {
                this.startTimer();
            }
        }); 

        this._pauseButton.connect('clicked', () => {
            this.pauseTimer();
        });

        this._stopButton.connect('clicked', () => {
            this.stopTimer();
        });
    }
    
    // ────────────────────────── ALARM SOUND
    _playAlarmSound() {
        let alarmFilePath = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share', 'gnome-shell', 'extensions', 'timer@lbgracioso.net', 'alarm.ogg']);
        let alarmFile = Gio.file_new_for_path(alarmFilePath);

        let player = Gst.ElementFactory.make('playbin', 'player');
        player.set_property('uri', 'file://' + alarmFile.get_path());

        player.set_state(Gst.State.PLAYING);
        
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            player.set_state(Gst.State.NULL);
            return GLib.SOURCE_REMOVE;  
        });
    }
    
    // ────────────────────────── UPDATE TITLE
    _updateTitleWithTime(hours, minutes, seconds) {
        let formattedTime = `${this._padTime(hours)}:${this._padTime(minutes)}:${this._padTime(seconds)}`;
        this._button._label.text = formattedTime;
    }
    
    _updateTitleWithString(str) {
        this._button._label.text = str;
    }
    
    _padTime(time) {
        return time < 10 ? '0' + time : time;
    }
  
    // ────────────────────────── TIMER COUNTDOWN
    _startCountdown(durationInSeconds) {
        if (this._timerInterval) {
            clearInterval(this._timerInterval);
        }
    
        this._timerInterval = setInterval(() => {
            let remainingTime = this._remainingTime;
            let hours = Math.floor(remainingTime / 3600);
            let minutes = Math.floor((remainingTime % 3600) / 60);
            let seconds = remainingTime % 60;
  
            this._updateTitleWithTime(hours, minutes, seconds);

            if (remainingTime <= 0) {
                clearInterval(this._timerInterval);
                this._updateTitleWithString('Timer'); 
                this._timerState = TimerState.Stopped;
                this._playAlarmSound();
            }

            this._remainingTime--;
        }, 1000); 
    }
    
    // ────────────────────────── TIME PARSER
    // User can input single time unit such as '1h', '1m', '1s'
    // or multiple time units such as '1h 1m 1s', etc.
    _parseTime(timeString) {
        let regex = /(\d+)([hms])/g;
        let match;
        let totalSeconds = 0;
        
        while ((match = regex.exec(timeString)) !== null) {
            let value = parseInt(match[1]);
            let unit = match[2];

            switch (unit) {
                case 'h':
                    totalSeconds += value * 3600;
                    break;
                case 'm':
                    totalSeconds += value * 60;
                    break;
                case 's':
                    totalSeconds += value;
                    break;
                default:
                    break;
            }
        }

        return totalSeconds;
    }
  
    startTimer() {
        let time = this._timerEntry.get_text().trim();
        if (time.length > 0) {
            let durationInSeconds = this._parseTime(time);
            if (durationInSeconds > 0 ) {
                log(`[TIMER EXTENSION] Starting timer for: ${time}`); 
                this._timerState = TimerState.Running;
                this._remainingTime = durationInSeconds;
                this._startCountdown();
                this._timerEntry.set_text('');                            
            } else {
                log('[TIMER EXTENSION] Invalid time format.');
            }
        }
    }

    pauseTimer() {
        log('[TIMER EXTENSION] Timer paused');
        clearInterval(this._timerInterval);
        this._timerState = TimerState.Paused;
        this._updateTitleWithString('Paused');
    }
    
    resumeTimer() {
        log('[TIMER EXTENSION] Timer resumed');
        this._timerState = TimerState.Running;
        this._startCountdown(); 
    }

    stopTimer() {
        log('[TIMER EXTENSION] Timer stopped');
        clearInterval(this._timerInterval);
        this._timerState = TimerState.Stopped;
        this._remainingTime = 0;
        this._timerEntry.set_text('');
        this._updateTitleWithString('Timer');
    }
}

const TimerState = {
    Running: Symbol("Running"),
    Paused: Symbol("Paused"),
    Stopped: Symbol("Stopped")
};

class TimerButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super(0.0, _('Timer'));

        this._label = new St.Label({
            text: _('Timer'),
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this.add_child(this._label);

        this.setMenu(new TimerMenu(this, 1.0, St.Side.TOP, this));
    }
}

export default class TimerExtension extends Extension {
    enable() {
        Gst.init(null);
        this._indicator = new TimerButton();
        Main.panel.addToStatusArea('panelTimer', this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

