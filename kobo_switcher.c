// kobo_switcher.c
//
// Simple program for old Kobo: use D-pad LEFT/RIGHT to switch between
// different remote framebuffers, fetched via wget and shown with pickel.
//
// Build for ARM and copy to /mnt/onboard/.kobo/kobo_switcher

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fcntl.h>
#include <linux/input.h>
#include <string.h>
#include <errno.h>

#define EVDEV_PATH "/dev/input/event0"   // may need to adjust
#define NUM_CHANNELS 3                   // how many dashboards you have

// List of framebuffer URLs to cycle through.
static const char *CHANNEL_URLS[NUM_CHANNELS] = {
    "http://192.168.3.26:8080/kobo-dashboard.raw",      // channel 0: HA weather
    "http://192.168.3.26:8081/other-dashboard.raw",     // channel 1
    "http://192.168.3.26:8082/yet-another.raw"          // channel 2
};

// Helper: fetch URL and show it with pickel.
static void show_channel(int idx) {
    if (idx < 0 || idx >= NUM_CHANNELS) return;

    const char *url = CHANNEL_URLS[idx];
    char cmd[512];

    // Download into pipe and show; also turn blink LED off afterwards.
    snprintf(
        cmd, sizeof(cmd),
        "wget -q -O - '%s' | /usr/local/Kobo/pickel showpic ; "
        "/usr/local/Kobo/pickel blinkoff 2>/dev/null || true",
        url
    );

    printf("Showing channel %d: %s\n", idx, url);
    fflush(stdout);

    // This blocks until the refresh is done.
    int rc = system(cmd);
    (void)rc;
}

int main(void) {
    int fd = open(EVDEV_PATH, O_RDONLY);
    if (fd < 0) {
        perror("open evdev");
        return 1;
    }

    // Kill Nickel once and turn off blink LED.
    system("pkill nickel 2>/dev/null || true");
    system("/usr/local/Kobo/pickel blinkoff 2>/dev/null || true");

    int current = 0;
    show_channel(current);

    struct input_event ev;
    while (1) {
        ssize_t n = read(fd, &ev, sizeof(ev));
        if (n != (ssize_t)sizeof(ev)) {
            if (n < 0 && errno == EINTR) continue;
            perror("read evdev");
            break;
        }

        // We care about key *press* events only (value == 1)
        if (ev.type == EV_KEY && ev.value == 1) {
            switch (ev.code) {
                case KEY_RIGHT:
                case KEY_PAGEDOWN:
                    current = (current + 1) % NUM_CHANNELS;
                    show_channel(current);
                    break;

                case KEY_LEFT:
                case KEY_PAGEUP:
                    current = (current - 1 + NUM_CHANNELS) % NUM_CHANNELS;
                    show_channel(current);
                    break;

                // Optional: a key to force redraw / refresh same channel
                case KEY_ENTER:
                case KEY_OK:
                    show_channel(current);
                    break;

                default:
                    break;
            }
        }
    }

    close(fd);
    return 0;
}
