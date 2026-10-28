`timescale 1ns / 1ps

// 同时仿真二进制与格雷码两个实例：CLK_HZ = 40、COUNT_HZ = 4 => 每 10 拍计数一次
module tb;
  localparam CLK_HZ = 40, COUNT_HZ = 4, DIV = CLK_HZ / COUNT_HZ;

  logic       clk = 0;
  logic [7:0] led_bin, led_gray;
  integer     errors = 0;

  led_counter #(.CLK_HZ(CLK_HZ), .COUNT_HZ(COUNT_HZ), .GRAY(0)) u_bin  (.clk(clk), .led(led_bin));
  led_counter #(.CLK_HZ(CLK_HZ), .COUNT_HZ(COUNT_HZ), .GRAY(1)) u_gray (.clk(clk), .led(led_gray));

  always #5 clk = ~clk;

  initial begin
    logic [7:0] prev_gray, diff;
    integer     ones;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    #1;
    prev_gray = led_gray;
    for (integer n = 0; n < 300; n = n + 1) begin
      if (led_bin !== n[7:0]) begin
        $display("错误：第 %0d 次计数 led = %0d", n, led_bin);
        errors = errors + 1;
      end
      if (n > 0) begin
        // 格雷码：相邻两个值恰好只有一位不同
        diff = led_gray ^ prev_gray;
        ones = 0;
        for (integer i = 0; i < 8; i = i + 1) ones = ones + diff[i];
        if (ones != 1) begin
          $display("错误：格雷码 %b -> %b 变化了 %0d 位", prev_gray, led_gray, ones);
          errors = errors + 1;
        end
      end
      if (n < 6 || n == 255 || n == 256)
        $display("计数 %3d：二进制 %b  格雷码 %b", n, led_bin, led_gray);
      prev_gray = led_gray;
      repeat (DIV) @(negedge clk);
    end

    if (errors == 0) $display("PASS: 二进制与格雷码计数正确（含 255 -> 0 回绕）");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
