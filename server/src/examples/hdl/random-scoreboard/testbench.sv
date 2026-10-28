`timescale 1ns / 1ps

// 分层测试平台的最小骨架：
//   激励（driver task + $random 随机化）→ DUT → 监视器（monitor）→ 记分板（scoreboard）
//   + 简单的功能覆盖率统计 + 最终 PASS/FAIL 报告
module tb;
  localparam W = 8;
  localparam N_TRANS = 500;

  logic                  clk = 0, rst = 1;
  logic                  in_valid = 0;
  logic signed [W-1:0]   a = 0, b = 0;
  logic signed [2*W-1:0] c = 0;
  logic                  out_valid;
  logic signed [2*W:0]   y;

  pipe_mac #(.W(W)) dut (
    .clk(clk), .rst(rst), .in_valid(in_valid), .a(a), .b(b), .c(c),
    .out_valid(out_valid), .y(y)
  );

  always #5 clk = ~clk;

  // ───────── 记分板：期望结果队列（数组 + 读写索引） ─────────
  logic signed [2*W:0] expected [0:N_TRANS-1];
  integer wr_idx = 0, rd_idx = 0;
  integer n_pass = 0, n_fail = 0;

  // ───────── 覆盖率计数 ─────────
  integer cov_zero = 0, cov_max_pos = 0, cov_max_neg = 0, cov_neg_result = 0, cov_back2back = 0;
  logic   last_valid = 0;

  // 驱动：把一笔事务送进 DUT，同时把参考模型的结果压入记分板
  task automatic drive(input logic signed [W-1:0] ta, input logic signed [W-1:0] tb_,
                       input logic signed [2*W-1:0] tc);
    @(negedge clk);
    in_valid = 1;
    a = ta;
    b = tb_;
    c = tc;
    expected[wr_idx] = ta * tb_ + tc;   // 参考模型
    wr_idx = wr_idx + 1;
    // 覆盖率采样
    if (ta == 0 || tb_ == 0)                     cov_zero = cov_zero + 1;
    if (ta == 127 && tb_ == 127)                 cov_max_pos = cov_max_pos + 1;
    if (ta == -128 && tb_ == -128)               cov_max_neg = cov_max_neg + 1;
    if (ta * tb_ + tc < 0)                       cov_neg_result = cov_neg_result + 1;
    if (last_valid)                              cov_back2back = cov_back2back + 1;
    last_valid = 1;
  endtask

  task automatic idle(input integer cycles);
    repeat (cycles) begin
      @(negedge clk);
      in_valid = 0;
      last_valid = 0;
    end
  endtask

  // 监视器 + 比较
  always @(posedge clk) begin
    if (!rst && out_valid) begin
      if (rd_idx >= wr_idx) begin
        $display("[%0t] 错误：DUT 输出了多余的结果 %0d", $time, y);
        n_fail = n_fail + 1;
      end else if (y !== expected[rd_idx]) begin
        $display("[%0t] 错误：第 %0d 笔结果 %0d，期望 %0d", $time, rd_idx, y, expected[rd_idx]);
        n_fail = n_fail + 1;
        rd_idx = rd_idx + 1;
      end else begin
        n_pass = n_pass + 1;
        rd_idx = rd_idx + 1;
      end
    end
  end

  initial begin
    integer k;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    // 定向的边界用例
    drive(8'sd127,  8'sd127,  16'sd0);
    drive(-8'sd128, -8'sd128, 16'sd32767);
    drive(-8'sd128, 8'sd127,  -16'sd32768);
    drive(8'sd0,    8'sd99,   16'sd1);
    idle(2);

    // 约束随机：70% 概率连续发送，30% 概率插入 1~3 拍空闲；10% 概率取边界值
    for (k = 4; k < N_TRANS; k = k + 1) begin
      logic signed [W-1:0] ra, rb;
      ra = $random;
      rb = $random;
      if (($random & 15) == 0) ra = (($random & 1) != 0) ? 8'sd127 : -8'sd128;
      if (($random & 15) == 0) rb = (($random & 1) != 0) ? 8'sd127 : -8'sd128;
      drive(ra, rb, $random);
      if (($random % 10 + 10) % 10 >= 7) idle(1 + ($random & 1) + ($random & 1));
    end
    idle(5);

    $display("──────────── 测试报告 ────────────");
    $display("事务数          : %0d（检查通过 %0d，失败 %0d）", wr_idx, n_pass, n_fail);
    $display("覆盖率 a 或 b = 0 : %0d 次", cov_zero);
    $display("覆盖率 127 × 127  : %0d 次", cov_max_pos);
    $display("覆盖率 -128 × -128: %0d 次", cov_max_neg);
    $display("覆盖率 结果为负   : %0d 次", cov_neg_result);
    $display("覆盖率 背靠背输入 : %0d 次", cov_back2back);

    if (n_fail == 0 && n_pass == wr_idx && rd_idx == wr_idx)
      $display("PASS: 记分板比对 %0d/%0d 全部一致", n_pass, wr_idx);
    else
      $display("FAIL: 失败 %0d 笔，未收到 %0d 笔", n_fail, wr_idx - rd_idx);
    $finish;
  end
endmodule
