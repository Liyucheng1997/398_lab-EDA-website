`timescale 1ns / 1ps

// 两个不相关的时钟：clk_a = 100 MHz，clk_b ≈ 37 MHz（周期 27 ns）
// 从 A 域发出 20 个脉冲，检查 B 域恰好收到 20 个；电平信号在 2~3 个 B 周期后到达。
module tb;
  logic clk_a = 0, clk_b = 0;
  logic rst_a = 1, rst_b = 1;
  logic pulse_a = 0, pulse_b;
  logic level_a = 0, level_b;
  integer sent = 0, received = 0, errors = 0;

  always #5    clk_a = ~clk_a;
  always #13.5 clk_b = ~clk_b;

  pulse_sync u_pulse (
    .clk_src(clk_a), .rst_src(rst_a), .pulse_src(pulse_a),
    .clk_dst(clk_b), .rst_dst(rst_b), .pulse_dst(pulse_b)
  );

  sync_2ff u_level (.clk_dst(clk_b), .rst_dst(rst_b), .d(level_a), .q(level_b));

  always @(posedge clk_b) if (pulse_b) received = received + 1;

  initial begin
    realtime t0, t1;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    #100;
    @(negedge clk_a) rst_a = 0;
    @(negedge clk_b) rst_b = 0;

    // 发送 20 个间隔随机（但大于 3 个 B 周期）的单拍脉冲
    repeat (20) begin
      repeat (10 + ($random & 15)) @(negedge clk_a);
      pulse_a = 1;
      sent = sent + 1;
      @(negedge clk_a) pulse_a = 0;
    end
    repeat (10) @(posedge clk_b);
    $display("A 域发送 %0d 个脉冲，B 域收到 %0d 个", sent, received);
    if (sent != received) errors = errors + 1;

    // 测量电平同步延迟
    @(negedge clk_a);
    level_a = 1;
    t0 = $realtime;
    wait (level_b == 1'b1);
    t1 = $realtime;
    $display("电平同步延迟 %0.1f ns（约 %0.1f 个 B 周期）", t1 - t0, (t1 - t0) / 27.0);
    if (t1 - t0 > 3 * 27.0) errors = errors + 1;

    if (errors == 0) $display("PASS: 跨时钟域同步正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
