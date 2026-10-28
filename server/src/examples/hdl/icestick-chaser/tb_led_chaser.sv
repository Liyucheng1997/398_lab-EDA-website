`timescale 1ns / 1ps

// CLK_HZ = 80、STEP_HZ = 8：每步 10 拍，心跳每 40 拍翻转一次
module tb;
  localparam CLK_HZ = 80, STEP_HZ = 8;

  logic       clk = 0;
  logic [4:0] led;
  integer     errors = 0;

  led_chaser #(.CLK_HZ(CLK_HZ), .STEP_HZ(STEP_HZ)) dut (.clk(clk), .led(led));

  always #5 clk = ~clk;

  initial begin
    logic [3:0] expect_ring;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    expect_ring = 4'b0001;
    #1;  // 第一个时钟上升沿在 5 ns，此处先检查初始状态，之后每个下降沿检查一次
    for (integer step = 0; step < 12; step = step + 1) begin
      // 每一步内的 10 拍里，圆环上恰好一个 LED 亮，且位置正确
      repeat (CLK_HZ / STEP_HZ) begin
        if (led[3:0] !== expect_ring) begin
          $display("[%0t] 错误：led[3:0] = %b，期望 %b", $time, led[3:0], expect_ring);
          errors = errors + 1;
        end
        @(negedge clk);
      end
      $display("第 %2d 步：D1~D4 = %b  D5 = %b", step + 1, led[3:0], led[4]);
      expect_ring = {expect_ring[2:0], expect_ring[3]};
      // 每 4 步（半秒）心跳翻转一次
      if (led[4] !== ((step + 1) / 4) % 2) begin
        $display("  错误：心跳 D5 = %b", led[4]);
        errors = errors + 1;
      end
    end

    if (errors == 0) $display("PASS: 流水灯与心跳灯正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
