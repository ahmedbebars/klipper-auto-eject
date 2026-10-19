// klipper-auto-eject - parts for a first test
// https://github.com/ahmedbebars/klipper-auto-eject
//
//   hollow_cube        a square ring with thin walls, like a cookie cutter.
//                      Print two or three, eject them, watch.
//   calibration_block  a solid block for AUTO_EJECT_CALIBRATE (Voron Tap
//                      and other probes that touch with the nozzle).
//
// Copyright (C) 2026 Ahmed Bebars
// This file may be distributed under the terms of the GNU GPLv3 license.

/* [Part] */
part = "hollow_cube"; // [hollow_cube, calibration_block]

/* [Hollow cube] */
cube_size = 25;
cube_height = 10;
wall = 1.6;

/* [Calibration block] */
block_size = 20;
block_height = 12;

if (part == "hollow_cube") {
    difference() {
        cube([cube_size, cube_size, cube_height]);
        translate([wall, wall, -1])
            cube([cube_size - 2 * wall, cube_size - 2 * wall, cube_height + 2]);
    }
} else {
    cube([block_size, block_size, block_height]);
}
