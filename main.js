document.addEventListener("DOMContentLoaded", function() {
  "use strict";

  let comparisonBody = document.getElementById("comparisonBody");

  loadImage("kitten.png");
  loadImage("rays.png");
  loadImage("checkerboard.png");

  document.getElementById("localFile").addEventListener("change", function(e) {
    let files = e.target.files;
    for (let i = 0, f; f = files[i]; i++) {
      if (!f.type.match('image.*')) {
        console.warn("Ignoring local file " + f.name + " with unsupported type " + f.type);
        continue;
      }
      loadImage(window.URL.createObjectURL(f));
    }
  });

  document.getElementById("addUrlForm").addEventListener("submit", function(e) {
    let imageUrl = document.getElementById("imageUrl");
    loadImage(imageUrl.value)
    imageUrl.value = "";

    // Don't actually submit the form, that would reload the page
    e.preventDefault();
  });

  function loadImage(url) {
    let img = new Image();
    img.addEventListener("load", function() {
      addLine(img);
    });
    img.crossOrigin = "Anonymous";
    img.src = url;
  }

  function addLine(img) {
    let imgCanvas = document.createElement("canvas");
    imgCanvas.width = img.width;
    imgCanvas.height = img.height;
    imgCanvas.getContext("2d").drawImage(img, 0, 0);

    let row = document.createElement("tr");
    let imgCell = document.createElement("td");
    imgCell.appendChild(img);
    row.appendChild(imgCell);
    comparisonBody.appendChild(row);

    upsample(edi, imgCanvas, addCanvas(row));
    upsample(daala, imgCanvas, addCanvas(row));
    upsample(bilinear, imgCanvas, addCanvas(row));
  }

  function addCanvas(row) {
    let cell = document.createElement("td");
    let canvas = document.createElement("canvas");
    cell.appendChild(canvas);
    row.appendChild(cell);
    return canvas;
  }

  function upsample(method, srcCanvas, dstCanvas) {
    let width = srcCanvas.width;
    let height = srcCanvas.height;
    let dstHeight = height * 2;
    let dstWidth = width * 2;
    let imgData = srcCanvas.getContext("2d").getImageData(0, 0, width, height).data;
    let buf = new Uint8ClampedArray(new ArrayBuffer(dstWidth * dstHeight * 4));

    dstCanvas.width = dstWidth;
    dstCanvas.height = dstHeight;

    method(width, height, imgData, buf);

    dstCanvas.getContext("2d").putImageData(
      new ImageData(buf, dstWidth, dstHeight), 0, 0);
  }

  function srcLuma(s, i) {
    let r = s[4*i];
    let g = s[4*i + 1];
    let b = s[4*i + 2];
    return Math.round(0.2126*r + 0.7152*g + 0.0722*b);
  }

  function setLuma(d, i, luma) {
    d[4*i] = d[4*i + 1] = d[4*i + 2] = luma;
    d[4*i + 3] = 255;
  }

  function atOffset(buf, offset) {
    // The Proxy API is part of ECMAScript 6
    return Proxy.create({
      get: function(target, attr) {
        if (attr == "plusOffset")
          return function(offset2) {
            return atOffset(buf, offset + offset2);
          };

        let i = parseInt(attr, 10);
        return srcLuma(buf, offset + i);
      },
      set: function(target, attr, value) {
        let i = parseInt(attr, 10);
        setLuma(buf, offset + i, value);
      }
    });
  }

  function bilinear(src_width, src_height, src_data, dest_data) {
    let src_stride = src_width;
    let dest_stride = 2 * src_width;
    let i, j;
    for (j = 0; j < src_height; j++) {
      let s = atOffset(src_data, src_stride * j);
      let d = atOffset(dest_data, dest_stride * 2 * j);

      for (i = 0; i < src_width; i++) {
        if (i < src_width - 1) {
          d[i * 2] = s[i];
          d[i * 2 + 1] = (s[i] + s[i + 1] + 1) >> 1;
        } else {
          d[i * 2] = s[i];
          d[i * 2 + 1] = s[i];
        }
      }
    }
    for (j = 0; j < src_height; j++) {
      let d = atOffset(dest_data, dest_stride * (2 * j + 1));

      if (j < src_height - 1) {
        for (i = 0; i < src_width * 2; i++)
          d[i] = (d[i - 1 * dest_stride] + d[i + 1 * dest_stride] + 1) >> 1;
      } else {
        for (i = 0; i < src_width * 2; i++)
          d[i] = d[i - dest_stride];
      }
    }
  }

  // Based on od_state_upsample8 in src/state.c in Daala
  function daala(src_width, src_height, src_data, dest_data) {
    function memset(dst, c, n) {
      for (let i = 0; i < n; i++)
        dst[i] = c;
    }
    function OD_COPY(dst, src, n) {
      for (let i = 0; i < n; i++)
        dst[i] = src[i];
    }
    // Don't bother with padding for the JS demo
    let ypad = 0;
    let xpad = 0;

    let src_stride = src_width;
    let dest_stride = 2 * src_width;
    let w = src_width;
    let h = src_height;
    let x, y;

    let src = atOffset(src_data, 0);
    let dst = atOffset(dest_data, 0);

    let ref_line_buf = new Array(8);
    for (let i = 0; i < 8; i++)
      ref_line_buf[i] = new Uint8ClampedArray(new ArrayBuffer(2*(w + xpad)));

    for (y = -ypad; y < h + ypad + 3; y++) {
      /*Horizontal filtering:*/
      if (y < h + ypad) {
        let buf;
        buf = ref_line_buf[y & 7];
        memset(buf - (xpad << 1), src[0], (xpad - 2) << 1);
        buf[0] = src[0];
        buf[1] = (20*(src[0] + src[1])
         - 5*(src[0] + src[2]) + src[0] + src[3] + 16) >> 5;
        buf[2] = src[1];
        buf[3] = (20*(src[1] + src[2])
         - 5*(src[0] + src[3]) + src[0] + src[4] + 16) >> 5;
        for (x = 2; x < w - 3; x++) {
          buf[x << 1] = src[x];
          buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
           - 5*(src[x - 1] + src[x + 2]) + src[x - 2] + src[x + 3] + 16) >> 5;
        }
        buf[x << 1] = src[x];
        buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
         - 5*(src[x - 1] + src[x + 2]) + src[x - 2] + src[x + 2] + 16) >> 5;
        x++;
        buf[x << 1] = src[x];
        buf[x << 1 | 1] = (20*(src[x] + src[x + 1])
         - 5*(src[x - 1] + src[x + 1]) + src[x - 2] + src[x + 1] + 16) >> 5;
        x++;
        buf[x << 1] = src[x];
        buf[x << 1 | 1] =
         (36*src[x] - 5*src[x - 1] + src[x - 2] + 16) >> 5;
        x++;
        buf[x << 1] = src[w - 1];
        buf[x << 1 | 1] = (31*src[w - 1] + src[w - 2] + 16) >> 5;
        memset(buf + (++x << 1), src[w - 1], (xpad - 1) << 1);
        if (y >= 0 && y + 1 < h)
          src = src.plusOffset(src_stride);
      }
      /*Vertical filtering:*/
      if (y >= -ypad + 3) {
        if (y < 1 || y > h + 3) {
          OD_COPY(dst - (xpad << 1),
           ref_line_buf[(y - 3) & 7] - (xpad << 1),
           (w + (xpad << 1)) << 1);
          dst = dst.plusOffset(dest_stride);
          OD_COPY(dst - (xpad << 1),
           ref_line_buf[(y - 3) & 7] - (xpad << 1),
           (w + (xpad << 1)) << 1);
          dst = dst.plusOffset(dest_stride);
        }
        else {
          let buf = new Array(6);
          buf[0] = ref_line_buf[(y - 5) & 7];
          buf[1] = ref_line_buf[(y - 4) & 7];
          buf[2] = ref_line_buf[(y - 3) & 7];
          buf[3] = ref_line_buf[(y - 2) & 7];
          buf[4] = ref_line_buf[(y - 1) & 7];
          buf[5] = ref_line_buf[(y - 0) & 7];
          // NOTE: this line needs to be tweaked (see original C code) to support padding
          OD_COPY(dst, ref_line_buf[(y - 3) & 7],
           (w + (xpad << 1)) << 1);

          dst = dst.plusOffset(dest_stride);
          for (x = -xpad << 1; x < (w + xpad) << 1; x++) {
            dst[x] = (20*(buf[2][x] + buf[3][x])
             - 5*(buf[1][x] + buf[4][x])
             + buf[0][x] + buf[5][x] + 16) >> 5;
          }
          dst = dst.plusOffset(dest_stride);
        }
      }
    }
  }

  // Original code by David Schleef: <./original/gstediupsample.c>
  // See also <http://schleef.org/ds/cgak-demo-1> and
  // <http://schleef.org/ds/cgak-demo-1.png>
  function edi(src_width, src_height, src_data, dest_data) {
    function reconstruct_v(src, stride, a, b, c, d)
    {
      let x;

      x = src[0 - 3 * stride] * a;
      x += src[0 - 2 * stride] * b;
      x += src[0 - 1 * stride] * c;
      x += src[0 - 0 * stride] * d;
      x += src[1 + 0 * stride] * d;
      x += src[1 + 1 * stride] * c;
      x += src[1 + 2 * stride] * b;
      x += src[1 + 3 * stride] * a;
      return (x + 16) >> 5;
    }

    function reconstruct_h(d1, d2, a, b, c, d)
    {
      let x;

      x = d1[-3] * a;
      x += d1[-2] * b;
      x += d1[-1] * c;
      x += d1[-0] * d;
      x += d2[0] * d;
      x += d2[1] * c;
      x += d2[2] * b;
      x += d2[3] * a;
      return (x + 16) >> 5;
    }

    let MARGIN = 3;
    let src_stride = src_width;
    let dest_stride = 2 * src_width;
    let i, j;
    for (j = 0; j < src_height; j++) {
      let s = atOffset(src_data, src_stride * j);
      let d = atOffset(dest_data, dest_stride * 2 * j);

      if (j >= MARGIN && j < src_height - MARGIN - 1) {
        for (i = 0; i < src_width - 1; i++) {
          let curr = s.plusOffset(i);
          let dx, dy, dx2;
          let v;

          dx = -s[-src_stride + i]
            - s[-src_stride + i + 1]
            + s[src_stride + i]
            + s[src_stride + i + 1];
          dx *= 2;

          dy = -s[-src_stride + i]
            - 2 * s[i]
            - s[src_stride + i]
            + s[-src_stride + i + 1]
            + 2 * s[i + 1]
            + s[src_stride + i + 1];

          dx2 = -s[-src_stride + i]
            + 2 * s[i]
            - s[src_stride + i]
            - s[-src_stride + i + 1]
            + 2 * s[i + 1]
            - s[src_stride + i + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
            v = (s[i] + s[i + 1] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_v(curr, src_stride, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_v(curr, src_stride, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_v(curr, src_stride, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_v(curr, src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(curr, src_stride, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_v(curr, -src_stride, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_v(curr, -src_stride, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_v(curr, -src_stride, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_v(curr, -src_stride, 1, 7, 7, 1);
            } else {
              v = reconstruct_v(curr, -src_stride, 4, 8, 4, 0);
            }
          }
          d[i * 2] = s[i];
          d[i * 2 + 1] = v;
        }
        d[i * 2] = s[i];
        d[i * 2 + 1] = s[i];
      } else {
        let s = atOffset(src_data, src_stride * j);
        let d1 = atOffset(dest_data, dest_stride * 2 * j);
        let d2 = atOffset(dest_data, dest_stride * (2 * j + 1));

        for (i = 0; i < src_width - 1; i++) {
          d1[i * 2] = s[i];
          d1[i * 2 + 1] = (s[i] + s[i + 1] + 1) >> 1;
          d2[i * 2] = s[i];
          d2[i * 2 + 1] = (s[i] + s[i + 1] + 1) >> 1;
        }
        d1[i * 2] = s[i];
        d1[i * 2 + 1] = s[i];
        d2[i * 2] = s[i];
        d2[i * 2 + 1] = s[i];
      }
    }
    for (j = 0; j < src_height - 1; j++) {
      let d1 = atOffset(dest_data, dest_stride * 2 * j);
      let d2 = atOffset(dest_data, dest_stride * (2 * j + 1));
      let d3 = atOffset(dest_data, dest_stride * (2 * j + 2));

      for (i = 0; i < src_width * 2; i++) {
        if (i >= MARGIN && i < src_width * 2 - MARGIN - 1) {
          let dx, dy;
          let dx2;
          let v;

          let curr1 = d1.plusOffset(i);
          let curr3 = d3.plusOffset(i);

          dx = -d1[i - 1]
            - d3[i - 1]
            + d1[i + 1]
            + d3[i + 1];
          dx *= 2;

          dy = -d1[i - 1]
            - 2 * d1[i]
            - d1[i + 1]
            + d3[i - 1]
            + 2 * d3[i]
            + d3[i + 1];

          dx2 = -d1[i - 1]
            + 2 * d1[i]
            - d1[i + 1]
            - d3[i - 1]
            + 2 * d3[i]
            - d3[i + 1];

          if (dy < 0) {
            dy = -dy;
            dx = -dx;
          }

          if (Math.abs(dx) <= 4 * Math.abs(dx2)) {
            v = (d1[i] + d3[i] + 1) >> 1;
          } else if (dx < 0) {
            if (dx < -2 * dy) {
              v = reconstruct_h(curr1, curr3, 0, 0, 0, 16);
            } else if (dx < -dy) {
              v = reconstruct_h(curr1, curr3, 0, 0, 8, 8);
            } else if (2 * dx < -dy) {
              v = reconstruct_h(curr1, curr3, 0, 4, 8, 4);
            } else if (3 * dx < -dy) {
              v = reconstruct_h(curr1, curr3, 1, 7, 7, 1);
            } else {
              v = reconstruct_h(curr1, curr3, 4, 8, 4, 0);
            }
          } else {
            if (dx > 2 * dy) {
              v = reconstruct_h(curr3, curr1, 0, 0, 0, 16);
            } else if (dx > dy) {
              v = reconstruct_h(curr3, curr1, 0, 0, 8, 8);
            } else if (2 * dx > dy) {
              v = reconstruct_h (curr3, curr1, 0, 4, 8, 4);
            } else if (3 * dx > dy) {
              v = reconstruct_h(curr3, curr1, 1, 7, 7, 1);
            } else {
              v = reconstruct_h(curr3, curr1, 4, 8, 4, 0);
            }
          }
          d2[i] = v;
        } else {
          d2[i] = (d1[i] + d3[i] + 1) >> 1;
        }
      }
    }
    {
      let d1 = atOffset(dest_data, dest_stride * 2 * j);
      let d2 = atOffset(dest_data, dest_stride * (2 * j + 1));

      for (i = 0; i < src_width; i++) {
        d1[2 * i + 1] = d1[i * 2];
        d2[2 * i] = d1[i * 2];
        d2[2 * i + 1] = d1[i * 2];
      }
    }
  }
});
