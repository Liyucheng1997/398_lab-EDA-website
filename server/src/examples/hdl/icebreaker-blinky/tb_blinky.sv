`timescale 1ns / 1ps

// 用 CLK_HZ = 100 仿真（0.5 s = 50 拍），检查红绿交替、秒计数和按键加速
module tb;
  localparam CLK_HZ = 100;

  logic       clk = 0, btn_n = 1;
  logic       led_r_n, led_g_n;
  logic [4:0] led;
  integer     errors = 0;

  blinky #(.CLK_HZ(CLK_HZ)) dut (
    .clk(clk), .btn_n(btn_n), .led_r_n(led_r_n), .led_g_n(led_g_n), .led(led)
  );

  always #5 clk = ~clk;

  // 统计 phase 保持不变的拍数
  task automatic measure_half(output integer cycles);
    logic start_r;
    start_r = led_r_n;
    cycles = 0;
    while (led_r_n == start_r) begin
      @(negedge clk);
      cycles = cycles + 1;
    end
  endtask

  initial begin
    integer n;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    @(negedge clk);
    if (led_r_n !== 1'b0 || led_g_n !== 1'b1) begin
      $display("错误：上电后应红灯亮、绿灯灭");
      errors = errors + 1;
    end

    measure_half(n);                      // 第一个半周期
    measure_half(n);
    $display("正常速度：半周期 %0d 拍（期望 %0d）", n, CLK_HZ / 2);
    if (n != CLK_HZ / 2) errors = errors + 1;
    if (led_r_n === led_g_n) begin
      $display("错误：红绿灯应互补");
      errors = errors + 1;
    end

    // 按住按键：加速 4 倍
    btn_n = 0;
    measure_half(n);
    measure_half(n);
    $display("按住按键：半周期 %0d 拍（期望约 %0d）", n, CLK_HZ / 8);
    // 步进为 4 时计到 HALF 需要 ceil((HALF-1)/4) 步，再加 1 拍清零
    if (n < CLK_HZ / 8 || n > CLK_HZ / 8 + 2) errors = errors + 1;
    btn_n = 1;

    // 秒计数应已累加
    $display("PMOD LED 秒计数 = %0d", led);
    if (led == 0) errors = errors + 1;

    if (errors == 0) $display("PASS: blinky 行为正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
