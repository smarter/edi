document.addEventListener("DOMContentLoaded", function() {
  "use strict";

  var comparisonBody = document.getElementById("comparisonBody");

  loadImage("kitten.png");
  loadImage("rays.png");
  loadImage("checkerboard.png");

  document.getElementById("localFile").addEventListener("change", function(e) {
    var files = e.target.files;
    for (var i = 0, f; f = files[i]; i++) {
      if (!f.type.match('image.*')) {
        console.warn("Ignoring local file " + f.name + " with unsupported type " + f.type);
        continue;
      }
      loadImage(window.URL.createObjectURL(f));
    }
  });


  function loadImage(url) {
    var img = new Image();
    img.addEventListener("load", function() {
      addLine(img);
    });
    img.src = url;
  }

  function addLine(img) {
    var imgCanvas = document.createElement("canvas");
    imgCanvas.width = img.width;
    imgCanvas.height = img.height;
    imgCanvas.getContext("2d").drawImage(img, 0, 0);

    var row = document.createElement("tr");
    var imgCell = document.createElement("td");
    imgCell.appendChild(img);
    row.appendChild(imgCell);
    comparisonBody.appendChild(row);

    upsample(edi, imgCanvas, addCanvas(row));
    upsample(bilinear, imgCanvas, addCanvas(row));
  }

  function addCanvas(row) {
    var cell = document.createElement("td");
    var canvas = document.createElement("canvas");
    cell.appendChild(canvas);
    row.appendChild(cell);
    return canvas;
  }

  function upsample(method, srcCanvas, dstCanvas) {
    var width = srcCanvas.width;
    var height = srcCanvas.height;
    var dstHeight = height * 2;
    var dstWidth = width * 2;
    var imgData = srcCanvas.getContext("2d").getImageData(0, 0, width, height).data;
    var buf = new Uint8ClampedArray(new ArrayBuffer(dstWidth * dstHeight * 4));

    dstCanvas.width = dstWidth;
    dstCanvas.height = dstHeight;

    method(width, height, imgData, buf);

    dstCanvas.getContext("2d").putImageData(
      new ImageData(buf, dstWidth, dstHeight), 0, 0);
  }

  function srcLuma(s, i) {
    var r = s[4*i];
    var g = s[4*i + 1];
    var b = s[4*i + 2];
    return Math.round(0.2126*r + 0.7152*g + 0.0722*b);
  }

  function setLuma(d, i, luma) {
    d[4*i] = d[4*i + 1] = d[4*i + 2] = luma;
    d[4*i + 3] = 255;
  }

  function atOffset(buf, offset) {
    // The Proxy API is part of ECMAScript 6
    return new Proxy({}, {
      get: function(target, attr) {
        var i = parseInt(attr, 10);
        return srcLuma(buf, offset + i);
      },
      set: function(target, attr, value) {
        var i = parseInt(attr, 10);
        setLuma(buf, offset + i, value);
      }
    });
  }

  function bilinear(src_width, src_height, src_data, dest_data) {
    var src_stride = src_width;
    var dest_stride = 2 * src_width;
    var i, j;
    for (j = 0; j < src_height; j++) {
      var s = atOffset(src_data, src_stride * j);
      var d = atOffset(dest_data, dest_stride * 2 * j);

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
      var d = atOffset(dest_data, dest_stride * (2 * j + 1));

      if (j < src_height - 1) {
        for (i = 0; i < src_width * 2; i++)
          d[i] = (d[i - 1 * dest_stride] + d[i + 1 * dest_stride] + 1) >> 1;
      } else {
        for (i = 0; i < src_width * 2; i++)
          d[i] = d[i - dest_stride];
      }
    }
  }

  // Original code by David Schleef: <./original/gstediupsample.c>
  // See also <http://schleef.org/ds/cgak-demo-1> and
  // <http://schleef.org/ds/cgak-demo-1.png>
  function edi(src_width, src_height, src_data, dest_data) {
    function reconstruct_v(src, stride, a, b, c, d)
    {
      var x;

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
      var x;

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

    var MARGIN = 3;
    var src_stride = src_width;
    var dest_stride = 2 * src_width;
    var i, j;
    for (j = 0; j < src_height; j++) {
      var s = atOffset(src_data, src_stride * j);
      var d = atOffset(dest_data, dest_stride * 2 * j);

      if (j >= MARGIN && j < src_height - MARGIN - 1) {
        for (i = 0; i < src_width - 1; i++) {
          var curr = atOffset(src_data, src_stride * j + i);
          var dx, dy, dx2;
          var v;

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
        var s = atOffset(src_data, src_stride * j);
        var d1 = atOffset(dest_data, dest_stride * 2 * j);
        var d2 = atOffset(dest_data, dest_stride * (2 * j + 1));

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
      var d1 = atOffset(dest_data, dest_stride * 2 * j);
      var d2 = atOffset(dest_data, dest_stride * (2 * j + 1));
      var d3 = atOffset(dest_data, dest_stride * (2 * j + 2));

      for (i = 0; i < src_width * 2; i++) {
        if (i >= MARGIN && i < src_width * 2 - MARGIN - 1) {
          var dx, dy;
          var dx2;
          var v;

          var curr1 = atOffset(dest_data, dest_stride * 2 * j + i);
          var curr3 = atOffset(dest_data, dest_stride * (2 * j + 2) + i);

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
      var d1 = atOffset(dest_data, dest_stride * 2 * j);
      var d2 = atOffset(dest_data, dest_stride * (2 * j + 1));

      for (i = 0; i < src_width; i++) {
        d1[2 * i + 1] = d1[i * 2];
        d2[2 * i] = d1[i * 2];
        d2[2 * i + 1] = d1[i * 2];
      }
    }
  }
});
